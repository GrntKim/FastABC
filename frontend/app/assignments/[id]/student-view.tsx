"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { api, type AssignmentOut, type CellOut, type RubricItemOut, type SubmissionOut } from "@/lib/api";
import { annotate } from "@/lib/highlight";
import {
  CHECK_HINT,
  DECISION_LABEL,
  formatPoints,
  itemMax,
  outcomeName,
  CHECK_TONE,
  checkReason,
  describePred,
  itemColor,
  itemName,
  KIND_HINT,
  outcome,
  plain,
  predPoints,
} from "@/lib/rubric";
import { cn } from "@/lib/utils";
import { useAcceptConfident, useClearDecisions, useDecide, useFindEvidence } from "@/lib/use-decide";
import SplitOpinion, { otherOptions } from "./split-opinion";

type SortMode = "attention" | "label" | "student";
const SORT_LABEL: Record<SortMode, string> = { attention: "확인 필요순", label: "라벨순", student: "학번순" };

type Workload = { human: number; llm: number; sampled: number; open: number; decided: number; total: number };

/** Undecided cells a person must look at, by kind, per submission. */
function workload(cells: CellOut[], submissionId: number): Workload {
  const own = cells.filter((c) => c.submission_id === submissionId);
  const open = own.filter((c) => c.final_points === null);
  return {
    human: open.filter((c) => c.route === "human").length,
    llm: open.filter((c) => c.route === "llm").length,
    sampled: open.filter((c) => c.sampled).length,
    open: open.length,
    decided: own.length - open.length,
    total: own.length,
  };
}

const attention = (w: Workload) => w.human + w.llm + w.sampled;

type Score = { sum: number; max: number; open: number; total: number | null };

/** Points so far for one student; the total (floored at 0, as in app/scoring.py) once every cell is decided. */
function scoreOf(items: RubricItemOut[], cells: CellOut[], submissionId: number): Score {
  const scored = new Map(items.filter((i) => i.kind !== "gate").map((i) => [i.id, i]));
  const own = cells.filter((c) => c.submission_id === submissionId && scored.has(c.rubric_item_id));
  const sum = own.reduce((acc, c) => acc + (c.final_points ?? 0), 0);
  const open = own.filter((c) => c.final_points === null).length;
  const max = [...scored.values()].reduce((acc, i) => acc + itemMax(i), 0);
  return { sum, max, open, total: own.length > 0 && open === 0 ? Math.max(0, sum) : null };
}

function sortIds(list: SubmissionOut[], cells: CellOut[], mode: SortMode): number[] {
  const sorted = [...list];
  if (mode === "student") sorted.sort((a, b) => a.student_ref.localeCompare(b.student_ref, "ko", { numeric: true }));
  else sorted.sort((a, b) => a.label.localeCompare(b.label));
  if (mode === "attention") {
    // direct-judgment cells first, then LLM-checked, then sampled, then other undecided; finished students last
    const key = (s: SubmissionOut) => {
      const w = workload(cells, s.id);
      return [-w.human, -w.llm, -w.sampled, w.open ? 0 : 1];
    };
    sorted.sort((a, b) => {
      const [ka, kb] = [key(a), key(b)];
      const i = ka.findIndex((v, j) => v !== kb[j]);
      return i === -1 ? 0 : ka[i] - kb[i];
    });
  }
  return sorted.map((s) => s.id);
}

/** One student at a time: the students on the side, then the answer and its items. */
export default function StudentView({ assignment, onGoResults }: { assignment: AssignmentOut; onGoResults: () => void }) {
  const submissions = useQuery({
    queryKey: ["submissions", assignment.id],
    queryFn: () => api<SubmissionOut[]>(`/assignments/${assignment.id}/submissions`),
  });
  const cells = useQuery({
    queryKey: ["cells", assignment.id],
    queryFn: () => api<CellOut[]>(`/assignments/${assignment.id}/cells`),
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  // Order is live until the grader acts, then frozen so students do not jump around while being graded
  const [frozen, setFrozen] = useState<{ mode: SortMode; ids: number[] } | null>(null);
  const acceptRest = useAcceptConfident(assignment.id);
  const locked = assignment.progress.stage === "finalized";

  if (!submissions.data || !cells.data) return <p className="text-muted-foreground pt-2">불러오는 중…</p>;
  const all = submissions.data;
  if (all.length === 0) return <p className="text-muted-foreground pt-2">답안이 없습니다.</p>;
  const cellList = cells.data;

  const loads = new Map(all.map((s) => [s.id, workload(cellList, s.id)]));
  const totalAttention = all.reduce((sum, s) => sum + attention(loads.get(s.id)!), 0);
  const totalOpen = all.reduce((sum, s) => sum + loads.get(s.id)!.open, 0);
  const mode: SortMode = frozen?.mode ?? (totalOpen === 0 ? "label" : "attention");
  const liveIds = sortIds(all, cellList, mode);
  const ids = frozen && frozen.ids.length === all.length ? frozen.ids : liveIds;
  const byId = new Map(all.map((s) => [s.id, s]));
  const list = ids.map((id) => byId.get(id)!).filter(Boolean);

  const index = Math.max(0, list.findIndex((s) => s.id === selected));
  const submission = list[index];
  const byItem = new Map(cellList.filter((c) => c.submission_id === submission.id).map((c) => [c.rubric_item_id, c]));
  const go = (i: number) => {
    if (!frozen) setFrozen({ mode, ids });
    setSelected(list[(i + list.length) % list.length].id);
    setFocused(null);
  };
  // Any action (a decision, bulk accept, …) pins the order and the open student before it changes the data
  const pin = () => {
    if (!frozen) setFrozen({ mode, ids });
    if (selected === null) setSelected(submission.id);
  };
  const resort = (next: SortMode) => setFrozen({ mode: next, ids: sortIds(all, cellList, next) });
  const nextAttention = [...list.slice(index + 1), ...list.slice(0, index + 1)].find(
    (s) => s.id !== submission.id && attention(loads.get(s.id)!) > 0,
  );

  // a banner only when there is something to do about the whole question
  const banner = locked ? (
    <div className="rounded-lg border bg-muted px-3 py-2 text-sm">
      성적이 확정되어 잠겼습니다. 고치려면 &lsquo;결과&rsquo; 탭에서 개정하세요.
    </div>
  ) : totalOpen === 0 ? (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
      <span>모든 칸을 확정했습니다. 이제 성적을 확정하세요.</span>
      <Button size="sm" className="ml-auto" onClick={onGoResults}>
        결과로 가기 →
      </Button>
    </div>
  ) : totalAttention === 0 ? (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm dark:border-sky-800 dark:bg-sky-950/40">
      <span>확인이 필요한 칸은 모두 끝났습니다. 남은 {totalOpen}칸은 추천대로 확정하면 됩니다.</span>
      <Button
        size="sm"
        className="ml-auto"
        disabled={acceptRest.isPending}
        onClick={() => confirm(`남은 ${totalOpen}칸을 모두 추천대로 확정할까요?`) && acceptRest.mutate({})}
      >
        남은 칸 추천대로 확정
      </Button>
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-4 pt-2" onClickCapture={pin}>
      {banner}
      <div className="grid items-start gap-4 lg:grid-cols-[9.5rem_1fr]">
        <StudentList
          list={list}
          current={index}
          loads={loads}
          scores={new Map(all.map((s) => [s.id, scoreOf(assignment.items, cellList, s.id)]))}
          totalAttention={totalAttention}
          mode={mode}
          canResort={frozen !== null}
          onSelect={go}
          onSort={resort}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <AnswerCard
            assignment={assignment}
            submission={submission}
            items={assignment.items}
            byItem={byItem}
            focused={focused}
            onFocus={setFocused}
          />
          <ItemList
            key={submission.id}
            assignmentId={assignment.id}
            submission={submission}
            items={assignment.items}
            byItem={byItem}
            focused={focused}
            onFocus={setFocused}
            locked={locked}
            footer={
              <>
                <Button size="sm" variant="ghost" onClick={() => go(index - 1)}>
                  ← 이전 학생
                </Button>
                {nextAttention ? (
                  <Button size="sm" className="ml-auto" onClick={() => go(list.indexOf(nextAttention))}>
                    다음 확인 필요 학생 ({nextAttention.label}) →
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => go(index + 1)}>
                    다음 학생 →
                  </Button>
                )}
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}

/** Who to grade: a column beside the work on wide screens, a wrapped row above it otherwise. */
function StudentList({
  list,
  current,
  loads,
  scores,
  totalAttention,
  mode,
  canResort,
  onSelect,
  onSort,
}: {
  list: SubmissionOut[];
  current: number;
  loads: Map<number, Workload>;
  scores: Map<number, Score>;
  totalAttention: number;
  mode: SortMode;
  canResort: boolean; // the order is frozen and may be stale
  onSelect: (index: number) => void;
  onSort: (mode: SortMode) => void;
}) {
  return (
    <nav className="flex flex-col gap-2 lg:sticky lg:top-4">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <select
          className="h-7 w-32 rounded-md border bg-card px-1.5 text-xs text-foreground lg:w-auto lg:min-w-0 lg:flex-1"
          value={mode}
          onChange={(e) => onSort(e.target.value as SortMode)}
          aria-label="정렬"
        >
          {(Object.keys(SORT_LABEL) as SortMode[]).map((m) => (
            <option key={m} value={m}>
              {SORT_LABEL[m]}
            </option>
          ))}
        </select>
        {canResort && (
          <Button size="xs" variant="ghost" onClick={() => onSort(mode)} title="지금 상태로 다시 정렬" aria-label="다시 정렬">
            ↻
          </Button>
        )}
      </div>
      {totalAttention > 0 && (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          확인 필요 <strong>{totalAttention}칸</strong>
        </p>
      )}
      <ul className="flex flex-row flex-wrap gap-1 lg:max-h-[70vh] lg:flex-col lg:flex-nowrap lg:overflow-y-auto">
        {list.map((s, i) => {
          const w = loads.get(s.id)!;
          const score = scores.get(s.id)!;
          const need = attention(w);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                title={`확정 ${w.decided}/${w.total}` + (need ? ` · 확인 필요 ${need}` : "")}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-sm transition-colors",
                  i === current ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {s.label}
                <span className="ml-auto text-xs">
                  {score.total !== null ? (
                    <span className={cn("font-sans tabular-nums", i !== current && "text-emerald-700 dark:text-emerald-400")}>
                      {score.total}/{score.max}
                    </span>
                  ) : (
                    need > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 font-sans font-medium",
                          i === current ? "bg-primary-foreground/20" : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
                        )}
                      >
                        {need}
                      </span>
                    )
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type CellsByItem = Map<number, CellOut>;

/** LLM output that can carry evidence: the escalation re-judgment, else the on-demand evidence lookup. */
const llmView = (cell: CellOut | undefined) => cell?.secondary ?? cell?.evidence ?? null;

function AnswerCard({
  assignment,
  submission,
  items,
  byItem,
  focused,
  onFocus,
}: {
  assignment: AssignmentOut;
  submission: SubmissionOut;
  items: RubricItemOut[];
  byItem: CellsByItem;
  focused: number | null;
  onFocus: (itemId: number | null) => void;
}) {
  // a confident off-topic gate skips every scored item
  const offTopic = [...byItem.values()].some((c) => c.route === "skip");
  const scored = items.filter((i) => i.kind !== "gate");
  const groups = scored.map((i) => ({ id: i.id, quotes: llmView(byItem.get(i.id))?.evidence ?? [] }));
  const segments = annotate(submission.clean_text, groups);

  // Evidence is fetched once per submission the first time a grader opens it (design option A)
  const findEvidence = useFindEvidence(assignment.id);
  const attempted = useRef(new Set<number>());
  const missing = scored.some((i) => {
    const cell = byItem.get(i.id);
    return cell && ["auto", "llm", "human"].includes(cell.route) && !llmView(cell);
  });
  const { mutate } = findEvidence;
  useEffect(() => {
    if (!missing || !submission.clean_text || attempted.current.has(submission.id)) return;
    attempted.current.add(submission.id);
    mutate(submission.id);
  }, [missing, submission.id, submission.clean_text, mutate]);

  return (
    // an exam paper: the question in bold, the student's answer written on ruled lines below it
    <article className="flex flex-col gap-4 rounded-sm bg-[oklch(0.995_0.008_90)] px-6 py-5 shadow-md ring-1 ring-stone-300 dark:bg-[oklch(0.2_0.005_90)] dark:ring-stone-700">
      <header className="flex items-center gap-3 border-b-2 border-foreground/80 pb-2 text-sm">
        <span className="font-medium">{assignment.assessment ?? assignment.title}</span>
        {assignment.assessment && <span className="text-muted-foreground">{assignment.title}</span>}
        <span className="ml-auto flex items-center gap-2">
          {findEvidence.isPending && <span className="text-xs text-muted-foreground">답안에서 근거 찾는 중…</span>}
          {findEvidence.isError && (
            <Button size="xs" variant="ghost" onClick={() => findEvidence.mutate(submission.id)}>
              근거 찾기 실패: 다시 시도
            </Button>
          )}
          <span className="text-xs text-muted-foreground">학생</span>
          <span className="border border-foreground/60 px-2 py-0.5 font-mono text-base font-semibold">{submission.label}</span>
        </span>
      </header>

      <p className="whitespace-pre-wrap text-lg font-bold leading-8">
        <span className="mr-1.5">문제.</span>
        {assignment.problem}
      </p>

      <section className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">답안</span>
          {offTopic && <Badge variant="destructive">문제와 관련 없는 답안</Badge>}
        </div>
        {submission.clean_text ? (
          <p className="answer-sheet whitespace-pre-wrap px-1 text-[1.05rem]">
            {segments.map((s, i) => {
              if (s.ids.length === 0) return <span key={i}>{s.text}</span>;
              const color = itemColor(items, s.ids[0]);
              const active = focused !== null && s.ids.includes(focused);
              return (
                <mark
                  key={i}
                  className={cn("cursor-pointer rounded px-0.5 text-inherit", color?.mark, active && "ring-2", active && color?.ring)}
                  title={s.ids.map((id) => items.find((it) => it.id === id)).map((it) => it && itemName(it)).join(", ")}
                  onClick={() => onFocus(s.ids[0])}
                >
                  {s.text}
                </mark>
              );
            })}
          </p>
        ) : (
          <p className="answer-sheet px-1 text-muted-foreground">(빈 답안)</p>
        )}
      </section>
    </article>
  );
}

/** Every scored item of one student: what to check, the recommendation, and the grader's decision. */
function ItemList({
  assignmentId,
  submission,
  items,
  byItem,
  focused,
  onFocus,
  locked,
  footer,
}: {
  assignmentId: number;
  submission: SubmissionOut;
  items: RubricItemOut[];
  byItem: CellsByItem;
  focused: number | null;
  onFocus: (itemId: number | null) => void;
  locked: boolean; // grades are finalized
  footer: React.ReactNode; // moving on to another student
}) {
  const acceptConfident = useAcceptConfident(assignmentId);
  const clearDecisions = useClearDecisions(assignmentId);
  const rows = items.filter((i) => i.kind !== "gate" && byItem.has(i.id)).map((item) => ({ item, cell: byItem.get(item.id)! }));
  // rows the grader opened or closed; the rest open only while they need a look
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const isOpen = (item: RubricItemOut, cell: CellOut) =>
    opened[item.id] ?? (cell.final_points === null && checkReason(cell) !== null);
  const allOpen = rows.every(({ item, cell }) => isOpen(item, cell));
  const score = scoreOf(items, [...byItem.values()], submission.id);
  const open = score.open;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        {/* what the grader keeps an eye on: how many points this student has */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm text-muted-foreground">{score.total === null ? "지금까지" : "총점"}</span>
          <span
            className={cn(
              "text-3xl font-bold tabular-nums",
              score.total !== null && "text-emerald-700 dark:text-emerald-400",
            )}
          >
            {score.total ?? formatPoints(score.sum)}
          </span>
          <span className="text-lg text-muted-foreground tabular-nums">/ {score.max}점</span>
          <span className={cn("ml-2 text-sm", open > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
            {open > 0 ? `${open}칸 미확정` : "✓ 채점 완료"}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => setOpened(Object.fromEntries(rows.map(({ item }) => [item.id, !allOpen])))}
        >
          {allOpen ? "모두 접기" : "모두 펼치기"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={acceptConfident.isPending || locked}
          onClick={() => acceptConfident.mutate({ submission_id: submission.id })}
          title="확인이 필요 없는 칸만 추천대로 확정합니다. 확인 필요로 표시된 칸은 그대로 둡니다."
        >
          추천대로 확정 (확인 필요 칸 제외)
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={clearDecisions.isPending || open === rows.length || locked}
          onClick={() =>
            confirm(`${submission.label}의 확정 ${rows.length - open}칸을 모두 취소할까요? 직접 고른 점수도 지워집니다.`) &&
            clearDecisions.mutate({ submission_id: submission.id })
          }
        >
          모두 취소
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col divide-y px-0">
        {rows.map(({ item, cell }) => (
          <ItemRow
            key={item.id}
            assignmentId={assignmentId}
            item={item}
            cell={cell}
            color={itemColor(items, item.id)}
            expanded={isOpen(item, cell)}
            onToggle={() => {
              const next = !isOpen(item, cell);
              setOpened({ ...opened, [item.id]: next });
              onFocus(next ? item.id : null);
            }}
            focused={focused === item.id}
            locked={locked}
          />
        ))}
      </CardContent>
      <div className="flex items-center gap-2 border-t px-4 pt-3">{footer}</div>
    </Card>
  );
}

/**
 * One item in the grader's words. Cells that need a look open with the reason and evidence;
 * cells whose recommendation can stand stay one line until opened.
 */
function ItemRow({
  assignmentId,
  item,
  cell,
  color,
  expanded,
  onToggle,
  focused,
  locked,
}: {
  assignmentId: number;
  item: RubricItemOut;
  cell: CellOut;
  color: ReturnType<typeof itemColor>;
  expanded: boolean;
  onToggle: () => void; // also marks the item's evidence in the answer
  focused: boolean;
  locked: boolean;
}) {
  const decide = useDecide(assignmentId);
  const decided = cell.final_points !== null;
  const reason = decided ? null : checkReason(cell);
  const busy = decide.isPending || locked;
  const set = (body: { action: "accept" | "clear" } | { action: "set"; points: number }) =>
    decide.mutate({ gradeId: cell.grade_id, body });

  const llm = llmView(cell);
  const judge = cell.secondary && cell.route !== "auto" ? cell.secondary : cell.primary;
  // an on-demand lookup that disagrees with a confident first judgment: worth a mention
  const otherView = cell.route === "auto" && llm?.pred != null && llm.pred !== cell.primary?.pred ? llm : null;
  const why = cell.route === "skip" ? "답안이 문제와 관련 없어 판단하지 않았습니다." : (llm?.reasoning ?? describePred(item, judge?.pred));
  const confidence = cell.primary?.conf != null ? `첫 판단 확신도 ${Math.round(cell.primary.conf * 100)}%` : undefined;

  return (
    <div className={cn("flex flex-col gap-2 px-4 py-2.5", reason && cn("border-l-4", CHECK_TONE[reason].edge), focused && "bg-muted/50")}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="w-3 shrink-0 text-xs text-muted-foreground">{expanded ? "▾" : "▸"}</span>
          <span className={cn("size-2.5 shrink-0 rounded-full", color?.dot)} />
          <span className="truncate font-medium" title={plain(item.instructions)}>
            {itemName(item)}
          </span>
          {item.kind === "deduction" && (
            <Badge variant="outline" title={KIND_HINT.deduction}>
              감점
            </Badge>
          )}
          {reason && (
            <span
              className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", CHECK_TONE[reason].chip)}
              title={CHECK_HINT[reason]}
            >
              {reason}
            </span>
          )}
        </button>
        {decided ? (
          <>
            <span className="whitespace-nowrap text-sm">
              <span className="text-emerald-700 dark:text-emerald-400">✓</span> {outcomeName(item, cell.final_points!)}
            </span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">{cell.decision && DECISION_LABEL[cell.decision]}</span>
            {!locked && (
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => set({ action: "clear" })}>
                취소
              </Button>
            )}
          </>
        ) : cell.recommended_points !== null ? (
          <>
            <span className="whitespace-nowrap text-sm" title={confidence}>
              추천 <strong>{outcome(item, cell.recommended_points)}</strong>
            </span>
            <Button
              size="sm"
              // a cell nobody needs to check is quiet: bulk confirm handles it
              variant={reason ? "default" : "secondary"}
              disabled={busy}
              onClick={() => set({ action: "accept" })}
            >
              확정
            </Button>
          </>
        ) : (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {cell.route === "pending" ? "추천을 기다리는 중" : "추천 없음 · 직접 고르세요"}
          </span>
        )}
        <span className="w-16 shrink-0 text-right tabular-nums" title={decided ? undefined : "아직 확정하지 않았습니다"}>
          {decided ? (
            <>
              <strong className={cn("text-xl", cell.final_points! < 0 && "text-rose-600 dark:text-rose-400")}>
                {formatPoints(cell.final_points!)}
              </strong>
              {item.kind === "credit" && <span className="text-sm text-muted-foreground">/{itemMax(item)}</span>}
            </>
          ) : (
            <span className="text-xl text-muted-foreground/50">–</span>
          )}
        </span>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 pb-1 pl-5 text-sm">
          {cell.route === "human" ? (
            <SplitOpinion item={item} cell={cell} disabled={busy} onPick={(points) => set({ action: "set", points })} />
          ) : (
            why && <p className="text-muted-foreground">{why}</p>
          )}
          {otherView && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              참고: 근거를 찾던 AI는 &lsquo;{outcome(item, predPoints(item, otherView.pred))}&rsquo;로 봤습니다. {otherView.reasoning}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1">
            {cell.route === "human" && otherOptions(item, cell).length > 0 && (
              <span className="mr-1 text-xs text-muted-foreground">다른 점수</span>
            )}
            {otherOptions(item, cell).map((o) => {
              const recommended = o.points === cell.recommended_points;
              return (
                <Button
                  key={o.label}
                  size="xs"
                  variant={cell.final_points === o.points ? "default" : "outline"}
                  className={cn(recommended && cell.final_points === null && "ring-2 ring-primary/40")}
                  disabled={busy || cell.route === "pending"}
                  onClick={() => set({ action: "set", points: o.points })}
                  title={recommended ? "추천" : undefined}
                >
                  {o.label}
                  {recommended && <span className="ml-1 text-[0.65rem] opacity-70">추천</span>}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

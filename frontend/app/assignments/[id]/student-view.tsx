"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type AssignmentOut, type CellOut, type RubricItemOut, type SubmissionOut } from "@/lib/api";
import { annotate } from "@/lib/highlight";
import {
  confLabel,
  describePred,
  formatPred,
  itemColor,
  itemName,
  KIND_HINT,
  KIND_LABEL,
  plain,
  pointOptions,
  ROUTE_LABEL,
  ROUTE_TONE,
  SAMPLED_HINT,
} from "@/lib/rubric";
import { cn } from "@/lib/utils";
import { useAcceptConfident, useClearDecisions, useDecide, useFindEvidence } from "@/lib/use-decide";

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

/** One student at a time: the whole answer first, judgments beside it, points below. */
export default function StudentView({ assignment }: { assignment: AssignmentOut }) {
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

  return (
    <div className="flex flex-col gap-4 pt-2" onClickCapture={pin}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm",
          locked
            ? "bg-muted"
            : totalAttention > 0
              ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
              : totalOpen > 0
                ? "border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40"
                : "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40",
        )}
      >
        {locked ? (
          <span>성적이 확정되어 잠겼습니다. 고치려면 &lsquo;결과&rsquo; 탭에서 개정하세요.</span>
        ) : totalAttention > 0 ? (
          <>
            <span>
              확인이 필요한 칸 <strong>{totalAttention}칸</strong> 남음
            </span>
            {nextAttention && (
              <Button size="sm" onClick={() => go(list.indexOf(nextAttention))}>
                다음 확인 필요 학생 ({nextAttention.label}) →
              </Button>
            )}
          </>
        ) : totalOpen > 0 ? (
          <>
            <span>확인이 필요한 칸은 모두 처리했습니다. 남은 {totalOpen}칸은 자동 판단입니다.</span>
            <Button
              size="sm"
              disabled={acceptRest.isPending}
              onClick={() =>
                confirm(`남은 자동 판단을 모두 추천대로 수용할까요? (샘플 검토 칸은 제외)`) && acceptRest.mutate({})
              }
            >
              나머지 일괄 수용
            </Button>
          </>
        ) : (
          <span>모든 칸을 확정했습니다. &lsquo;결과&rsquo; 탭에서 성적을 확정하세요.</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {(Object.keys(SORT_LABEL) as SortMode[]).map((m) => (
            <Button key={m} size="xs" variant={m === mode ? "secondary" : "ghost"} onClick={() => resort(m)}>
              {SORT_LABEL[m]}
            </Button>
          ))}
          {frozen && (
            <Button size="xs" variant="ghost" onClick={() => resort(mode)} title="지금 상태로 다시 정렬">
              다시 정렬
            </Button>
          )}
        </span>
      </div>

      <nav className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => go(index - 1)} aria-label="이전 학생">
          ←
        </Button>
        {list.map((s, i) => {
          const w = loads.get(s.id)!;
          const done = w.total > 0 && w.open === 0;
          return (
            <Button
              key={s.id}
              size="sm"
              variant={i === index ? "default" : "outline"}
              className="font-mono"
              onClick={() => go(i)}
              title={`확정 ${w.decided}/${w.total}` + (attention(w) ? ` · 확인 필요 ${attention(w)}` : "")}
            >
              {s.label}
              {done ? " ✓" : attention(w) > 0 && <span className="ml-0.5 text-[0.65rem] text-destructive">●</span>}
            </Button>
          );
        })}
        <Button size="sm" variant="ghost" onClick={() => go(index + 1)} aria-label="다음 학생">
          →
        </Button>
      </nav>

      <AnswerCard
        assignmentId={assignment.id}
        submission={submission}
        items={assignment.items}
        byItem={byItem}
        focused={focused}
        onFocus={setFocused}
      />
      <JudgmentNotes
        assignmentId={assignment.id}
        items={assignment.items}
        byItem={byItem}
        focused={focused}
        onFocus={setFocused}
        locked={locked}
      />

      <ScoreSummary
        assignmentId={assignment.id}
        submission={submission}
        items={assignment.items}
        byItem={byItem}
        locked={locked}
      />
    </div>
  );
}

type CellsByItem = Map<number, CellOut>;

/** LLM output that can carry evidence: the escalation re-judgment, else the on-demand evidence lookup. */
const llmView = (cell: CellOut | undefined) => cell?.secondary ?? cell?.evidence ?? null;

function AnswerCard({
  assignmentId,
  submission,
  items,
  byItem,
  focused,
  onFocus,
}: {
  assignmentId: number;
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
  const findEvidence = useFindEvidence(assignmentId);
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
    // the answer reads like a memo on the desk: the one thing on screen the grader must read
    <Card className="bg-yellow-50 shadow-sm ring-yellow-300/70 dark:bg-yellow-950/30 dark:ring-yellow-800/50">
      <CardHeader className="flex flex-row items-baseline gap-2">
        <CardTitle className="font-mono text-lg">{submission.label}</CardTitle>
        <span className="text-xs text-muted-foreground">학생 답안</span>
        {offTopic && <Badge variant="destructive">주제에서 벗어난 답안</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {findEvidence.isPending && "답안에서 근거 찾는 중…"}
          {findEvidence.isError && (
            <Button size="xs" variant="ghost" onClick={() => findEvidence.mutate(submission.id)}>
              근거 찾기 실패: 다시 시도
            </Button>
          )}
        </span>
      </CardHeader>
      <CardContent>
        {submission.clean_text ? (
          <p className="whitespace-pre-wrap text-[1.05rem] leading-8">
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
          <p className="text-muted-foreground">(빈 답안)</p>
        )}
      </CardContent>
    </Card>
  );
}


function JudgmentNotes({
  assignmentId,
  items,
  byItem,
  focused,
  onFocus,
  locked,
}: {
  assignmentId: number;
  items: RubricItemOut[];
  byItem: CellsByItem;
  focused: number | null;
  onFocus: (itemId: number | null) => void;
  locked: boolean;
}) {
  return (
    <div className="grid items-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {items
        .filter((i) => i.kind !== "gate")
        .map((item) => {
          const cell = byItem.get(item.id);
          if (!cell) return null;
          const color = itemColor(items, item.id);
          const judge = cell.secondary && cell.route !== "auto" ? cell.secondary : cell.primary;
          const llm = llmView(cell);
          // an on-demand lookup that disagrees with a confident decision-model judgment: worth a second look
          const disagrees = cell.route === "auto" && llm?.pred != null && llm.pred !== cell.primary?.pred;
          // undecided cells the grader must look at get an accent edge
          const accent =
            cell.decision === null &&
            (cell.route === "human"
              ? "border-l-4 border-l-rose-400"
              : cell.route === "llm"
                ? "border-l-4 border-l-violet-400"
                : cell.sampled && "border-l-4 border-l-amber-400");
          return (
            <div
              key={item.id}
              className={cn(
                "flex flex-col rounded-lg border bg-card text-sm shadow-xs",
                accent,
                cell.decision !== null && "bg-muted/40",
                focused === item.id && cn("ring-2", color?.ring),
              )}
            >
              {/* the judgment: clicking it marks its evidence in the answer */}
              <button
                type="button"
                onClick={() => onFocus(focused === item.id ? null : item.id)}
                className="flex flex-col gap-1 rounded-t-lg p-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("size-2.5 shrink-0 rounded-full", color?.dot)} />
                  <span className="font-medium" title={plain(item.instructions)}>
                    {itemName(item)}
                  </span>
                  {item.kind === "deduction" && (
                    <Badge variant="outline" title={KIND_HINT.deduction}>
                      감점
                    </Badge>
                  )}
                  <span className="ml-auto flex shrink-0 gap-1">
                    {cell.sampled && cell.decision === null && (
                      <span
                        className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                        title={SAMPLED_HINT}
                      >
                        샘플 검토
                      </span>
                    )}
                    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", ROUTE_TONE[cell.route])}>
                      {ROUTE_LABEL[cell.route]}
                    </span>
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <strong>{cell.route === "skip" ? "판단 생략" : formatPred(item, judge?.pred)}</strong>
                  {cell.primary?.conf != null && cell.route !== "skip" && (
                    <span className="text-xs text-muted-foreground" title={`확신도 ${Math.round(cell.primary.conf * 100)}%`}>
                      {confLabel(cell.primary.conf)}
                    </span>
                  )}
                </div>
                {cell.route !== "skip" && (
                  <p className="text-muted-foreground">
                    {disagrees ? describePred(item, judge?.pred) : (llm?.reasoning ?? describePred(item, judge?.pred))}
                  </p>
                )}
                {cell.route === "human" && <p className="text-destructive text-xs">두 판단이 달라 직접 판단이 필요합니다.</p>}
                {disagrees && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    참고: LLM은 &lsquo;{formatPred(item, llm.pred)}&rsquo;로 봤습니다. {llm.reasoning}
                  </p>
                )}
              </button>
              <CellDecision assignmentId={assignmentId} item={item} cell={cell} locked={locked} />
            </div>
          );
        })}
    </div>
  );
}

const DECISION_LABEL: Record<string, string> = { accepted: "추천 수용", modified: "수정", manual: "직접 입력" };

/** The grader's decision for one cell: accept the recommendation, or pick the points. */
function CellDecision({
  assignmentId,
  item,
  cell,
  locked,
}: {
  assignmentId: number;
  item: RubricItemOut;
  cell: CellOut;
  locked: boolean; // grades are finalized
}) {
  const decide = useDecide(assignmentId);
  const blocked = cell.route === "pending";
  const busy = decide.isPending || locked;
  const set = (body: { action: "accept" | "clear" } | { action: "set"; points: number }) =>
    decide.mutate({ gradeId: cell.grade_id, body });

  return (
    <div className="flex flex-col gap-2 border-t px-3 py-2">
      {cell.final_points !== null ? (
        <div className="flex items-center gap-2">
          <span className="text-emerald-700 dark:text-emerald-400">✓</span>
          <strong>{cell.final_points}점</strong>
          <span className="text-xs text-muted-foreground">{cell.decision && DECISION_LABEL[cell.decision]}</span>
          {!locked && (
            <Button size="xs" variant="ghost" className="ml-auto" disabled={busy} onClick={() => set({ action: "clear" })}>
              취소
            </Button>
          )}
        </div>
      ) : cell.recommended_points !== null ? (
        // confident auto cells can go through bulk accept: keep their button quiet so the ones to check stand out
        <Button
          size="sm"
          variant={cell.route === "auto" && !cell.sampled ? "secondary" : "default"}
          disabled={busy}
          onClick={() => set({ action: "accept" })}
        >
          추천 {cell.recommended_points}점 수용
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">{blocked ? "LLM 재판단 중…" : "추천 없음: 아래에서 점수를 고르세요"}</span>
      )}
      <div className="flex flex-wrap gap-1">
        {pointOptions(item).map((o) => (
          <Button
            key={o.label}
            size="xs"
            variant={cell.final_points === o.points ? "default" : "outline"}
            disabled={busy || blocked}
            onClick={() => set({ action: "set", points: o.points })}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Per-item final points, the total, and the per-student bulk actions. */
function ScoreSummary({
  assignmentId,
  submission,
  items,
  byItem,
  locked,
}: {
  assignmentId: number;
  submission: SubmissionOut;
  items: RubricItemOut[];
  byItem: CellsByItem;
  locked: boolean; // grades are finalized
}) {
  const acceptConfident = useAcceptConfident(assignmentId);
  const clearDecisions = useClearDecisions(assignmentId);
  const rows = items.map((item) => ({ item, cell: byItem.get(item.id) })).filter((r) => r.cell);
  const finals = rows.map((r) => r.cell!.final_points);
  const open = finals.filter((p) => p === null).length;
  // mirrors app/scoring.py total(): floored at 0, only once every cell is decided
  const total = open === 0 ? Math.max(0, finals.reduce<number>((sum, p) => sum + (p ?? 0), 0)) : null;
  const maxPoints = rows.reduce((sum, { item }) => {
    if (item.kind !== "credit") return sum;
    return sum + (item.points ?? Math.max(0, ...Object.values(item.points_map ?? {})));
  }, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle>점수</CardTitle>
        <span className="ml-2 text-base">
          {total === null ? (
            <span className="text-muted-foreground">{open}칸 미확정</span>
          ) : (
            <strong>
              총점 {total} / {maxPoints}점
            </strong>
          )}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={acceptConfident.isPending || locked}
          onClick={() => acceptConfident.mutate({ submission_id: submission.id })}
          title="자동 판단 중 확신 높은 칸만 수용합니다. LLM 확인·직접 판단·샘플 검토 칸은 제외됩니다."
        >
          고확신 항목 일괄 수용
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={clearDecisions.isPending || open === rows.length || locked}
          onClick={() =>
            confirm(`${submission.label}의 확정 ${rows.length - open}칸을 모두 취소할까요? 직접 입력한 점수도 지워집니다.`) &&
            clearDecisions.mutate({ submission_id: submission.id })
          }
        >
          일괄 취소
        </Button>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-5 gap-y-1">
        {rows.map(({ item, cell }) => (
          <span key={item.id} className="flex items-center gap-1.5" title={KIND_LABEL[item.kind]}>
            <span className={cn("size-2 shrink-0 rounded-full", itemColor(items, item.id)?.dot)} />
            {itemName(item)}
            <strong className={cn(cell!.final_points === null && "font-normal text-muted-foreground")}>
              {cell!.final_points === null ? "—" : `${cell!.final_points}점`}
            </strong>
          </span>
        ))}
      </CardContent>
    </Card>
  );
}

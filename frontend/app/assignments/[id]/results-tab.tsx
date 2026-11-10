"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { dueFor, dueStatus, GradesDue, useGradesDue } from "@/components/grades-due";
import { progressSegments, SegmentBar, SegmentLegend, type Segment } from "@/components/segment-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, json, type AssignmentOut, type CellOut, type FinalizationOut } from "@/lib/api";
import { checkReason, DECISION_LABEL } from "@/lib/rubric";
import { useMe } from "@/lib/use-me";
import ResultsPanel from "./results-panel";

/** How the confirmed items were settled: as recommended unseen, looked at by the grader, or changed by the grader. */
function settled(cells: CellOut[]) {
  const decided = cells.filter((c) => c.decision !== null);
  const changed = decided.filter((c) => c.decision === "modified").length;
  // the random audit of confident items: how many the grader looked at, and how many the AI had wrong
  const sampled = decided.filter((c) => c.sampled);
  const audit = { checked: sampled.length, fixed: sampled.filter((c) => c.decision === "modified").length };
  const looked = decided.filter((c) => c.decision === "modified" || checkReason(c) !== null).length;
  const segments: Segment[] = [
    { n: decided.length - looked, label: "AI가 확신해 추천대로 확정", className: "bg-sky-300 dark:bg-sky-700" },
    { n: looked - changed, label: "직접 확인", className: "bg-emerald-500" },
    { n: changed, label: "AI 추천을 고침", className: "bg-violet-500" },
  ];
  return { looked, changed, segments, audit };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Decision summary, sign-off and revisions, then every student's total once every item is confirmed. */
export default function ResultsTab({ assignment, onGoGrade }: { assignment: AssignmentOut; onGoGrade: () => void }) {
  const cells = useQuery({
    queryKey: ["cells", assignment.id],
    queryFn: () => api<CellOut[]>(`/assignments/${assignment.id}/cells`),
  });
  const history = useQuery({
    queryKey: ["finalizations", assignment.id],
    queryFn: () => api<FinalizationOut[]>(`/assignments/${assignment.id}/finalizations`),
  });
  const [dialog, setDialog] = useState<"finalize" | "reopen" | null>(null);

  if (!cells.data || !history.data) return <p className="text-muted-foreground pt-2">불러오는 중…</p>;
  const counts = { accepted: 0, modified: 0, manual: 0 } as Record<string, number>;
  for (const c of cells.data) if (c.decision) counts[c.decision] += 1;
  const open = cells.data.filter((c) => c.decision === null).length;
  const locked = assignment.progress.stage === "finalized";
  const current = locked ? history.data[0] : undefined;
  const past = current ? history.data.slice(1) : history.data; // the current version is shown above
  const quick = cells.data.filter((c) => c.decision === null && (c.route === "auto" || c.route === "skip") && !c.sampled).length;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <CardTitle>성적 확정</CardTitle>
          {!locked && <GradesDue term={assignment.course.term} question={{ examName: assignment.exam_name }} />}
          <span className="ml-auto">
            {locked ? (
              <Button variant="outline" onClick={() => setDialog("reopen")}>
                개정
              </Button>
            ) : (
              <Button disabled={open > 0} onClick={() => setDialog("finalize")}>
                성적 확정
              </Button>
            )}
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {open > 0 && !locked ? (
            // not ready to sign off: where grading stands, and the way back to it
            <div className="flex flex-col gap-2">
              <SegmentBar segments={progressSegments(cells.data.length - open, quick, open - quick)} />
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  학생 <strong>{assignment.progress.students_done}</strong> / {assignment.progress.submissions}명 채점 끝
                </span>
                <Button size="sm" className="ml-auto" onClick={onGoGrade}>
                  채점하러 가기
                </Button>
              </div>
            </div>
          ) : (
            <Settled cells={cells.data} students={assignment.progress.submissions} counts={counts} />
          )}
          {current ? (
            <p className="rounded-md border bg-muted/30 px-3 py-2">
              <strong title={`결과 해시 ${current.snapshot_hash}`}>v{current.version} 확정</strong> · {current.finalized_by} ·{" "}
              {when(current.finalized_at)}
              {current.late && " · 마감 후 확정"}
              <span className="text-muted-foreground"> — 점수가 잠겼습니다. 고치려면 사유를 적고 개정하세요.</span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              {open > 0
                ? "모든 학생의 채점이 끝나면 성적을 확정할 수 있습니다."
                : "모든 항목을 확정했습니다. 성적을 확정하면 확정자와 시각이 기록되고 점수가 잠깁니다."}
            </p>
          )}
          {past.length > 0 && (
            <ul className="flex flex-col gap-1 text-muted-foreground">
              <li className="text-xs">이전 버전</li>
              {past.map((f) => (
                <li key={f.id}>
                  <span title={`결과 해시 ${f.snapshot_hash}`}>v{f.version}</span> · {f.finalized_by} · {when(f.finalized_at)}
                  {f.late && " · 마감 후 확정"}
                  {f.reopened_at && ` · ${when(f.reopened_at)} 개정: ${f.reopen_reason}`}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {(open === 0 || locked) && <ResultsPanel assignmentId={assignment.id} />}

      <FinalizeDialog
        assignmentId={assignment.id}
        term={assignment.course.term}
        examName={assignment.exam_name}
        counts={counts}
        open={dialog === "finalize"}
        onOpenChange={(o) => setDialog(o ? "finalize" : null)}
      />
      <ReopenDialog assignmentId={assignment.id} open={dialog === "reopen"} onOpenChange={(o) => setDialog(o ? "reopen" : null)} />
    </div>
  );
}

/** Who answers for the grades: what the grader looked at and changed, not only what the AI suggested. */
function Settled({ cells, students, counts }: { cells: CellOut[]; students: number; counts: Record<string, number> }) {
  const { looked, changed, segments, audit } = settled(cells);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base">
        학생 {students}명 · 직접 확인한 항목 <strong>{looked}개</strong> · AI 추천을 고친 항목 <strong>{changed}개</strong>
      </p>
      <SegmentBar segments={segments} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <SegmentLegend segments={segments} />
        <span className="ml-auto" title="성적 확정 기록에 남는 구분입니다">
          {Object.entries(DECISION_LABEL)
            .map(([key, label]) => `${label} ${counts[key]}`)
            .join(" · ")}
        </span>
      </div>
      {audit.checked > 0 && (
        // what the random audit found: the reason it asked for those looks
        <p className="text-sm">
          무작위 점검{" "}
          {audit.fixed > 0 ? (
            <>
              <strong>{audit.checked}개</strong> 중 <strong className="text-violet-700 dark:text-violet-400">{audit.fixed}개</strong>는 AI
              추천을 고쳤습니다.
              <span className="text-muted-foreground"> AI가 확신한 항목도 이만큼 틀릴 수 있어 일부를 골라 보게 했습니다.</span>
            </>
          ) : (
            <>
              <strong>{audit.checked}개</strong>는 모두 AI 추천이 맞았습니다.
              <span className="text-muted-foreground"> 확신한 항목 중 일부를 골라 AI 판단을 점검한 결과입니다.</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function useSignOff<T>(path: string, done: string, onDone: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api<FinalizationOut>(path, json(body)),
    onSuccess: () => {
      toast.success(done);
      queryClient.invalidateQueries(); // stage, lock and history show on every screen
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? String(e.detail) : "저장하지 못했습니다"),
  });
}

function FinalizeDialog({
  assignmentId,
  term,
  examName,
  counts,
  open,
  onOpenChange,
}: {
  assignmentId: number;
  term: string;
  examName: string | null;
  counts: Record<string, number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useMe();
  const [confirmed, setConfirmed] = useState(false);
  const due = dueFor(useGradesDue(term).data, examName);
  const late = due ? { ...dueStatus(due.date), label: due.label } : null;
  const past = late?.past ?? false;
  const save = useSignOff<{ confirmed: true; late_ok: boolean }>(
    `/assignments/${assignmentId}/finalizations`,
    "성적을 확정했습니다",
    () => onOpenChange(false),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>성적 확정</DialogTitle>
          <DialogDescription>
            추천 수용 {counts.accepted}개, 수정 {counts.modified}개, 직접 입력 {counts.manual}개 항목입니다. 확정하면 점수가
            잠기고, 이후 변경은 개정판으로 남습니다.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmed) save.mutate({ confirmed: true, late_ok: past });
          }}
        >
          <p className="text-sm">
            확정자 <strong>{me.data?.name}</strong>
            <span className="text-muted-foreground"> (로그인한 계정)</span>
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            모든 항목을 확인했고, 이 점수에 대한 책임은 채점자에게 있습니다.
          </label>
          {past && (
            // a soft line: past the due date the grader is asked once more, and the sign-off is marked late
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              {late!.label} 성적 입력 마감일({late!.date})이 지났습니다. 그래도 확정하시겠습니까?
              <span className="block text-xs text-muted-foreground">확정 기록에 &lsquo;마감 후 확정&rsquo;으로 남습니다.</span>
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!confirmed || save.isPending}>
              {past ? "그래도 확정" : "확정"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({
  assignmentId,
  open,
  onOpenChange,
}: {
  assignmentId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const save = useSignOff<{ reason: string }>(`/assignments/${assignmentId}/reopen`, "개정을 시작했습니다", () =>
    onOpenChange(false),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>개정</DialogTitle>
          <DialogDescription>
            잠금을 풀고 점수를 고칩니다. 지금 확정본은 이력으로 남고, 다시 확정하면 다음 버전이 됩니다.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) save.mutate({ reason: reason.trim() });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            개정 사유 (필수)
            <Textarea value={reason} placeholder="예: 이의 제기 반영, 채점 실수 수정" onChange={(e) => setReason(e.target.value)} />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={!reason.trim() || save.isPending}>
              개정 시작
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

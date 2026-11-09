"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { progressSegments, SegmentBar } from "@/components/segment-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, json, type AssignmentOut, type CellOut, type FinalizationOut } from "@/lib/api";
import { DECISION_LABEL } from "@/lib/rubric";
import ResultsPanel from "./results-panel";

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
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>학생 {assignment.progress.submissions}명</span>
              {Object.entries(DECISION_LABEL).map(([key, label]) => (
                <span key={key}>
                  {label} <strong>{counts[key]}</strong>
                </span>
              ))}
            </div>
          )}
          {current ? (
            <p className="rounded-md border bg-muted/30 px-3 py-2">
              <strong title={`결과 해시 ${current.snapshot_hash}`}>v{current.version} 확정</strong> · {current.finalized_by} ·{" "}
              {when(current.finalized_at)}
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
        counts={counts}
        open={dialog === "finalize"}
        onOpenChange={(o) => setDialog(o ? "finalize" : null)}
      />
      <ReopenDialog assignmentId={assignment.id} open={dialog === "reopen"} onOpenChange={(o) => setDialog(o ? "reopen" : null)} />
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
  counts,
  open,
  onOpenChange,
}: {
  assignmentId: number;
  counts: Record<string, number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const save = useSignOff<{ finalized_by: string; confirmed: true }>(
    `/assignments/${assignmentId}/finalizations`,
    "성적을 확정했습니다",
    () => onOpenChange(false),
  );
  const valid = name.trim() !== "" && confirmed;

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
            if (valid) save.mutate({ finalized_by: name.trim(), confirmed: true });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            확정자
            <Input value={name} placeholder="이름" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            모든 항목을 확인했고, 이 점수에 대한 책임은 채점자에게 있습니다.
          </label>
          <DialogFooter>
            <Button type="submit" disabled={!valid || save.isPending}>
              확정
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

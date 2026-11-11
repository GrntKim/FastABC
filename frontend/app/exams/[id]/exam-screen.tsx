"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ExportButton } from "@/components/export-dialog";
import { GradesDue } from "@/components/grades-due";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, API_URL, ApiError, type ExamColumn, type ExamResults } from "@/lib/api";
import { STAGE_LABEL, STAGE_VARIANT, termLabel } from "@/lib/progress";
import { formatPoints } from "@/lib/rubric";
import { cn } from "@/lib/utils";
import SheetUpload, { answeredBy } from "./sheet-upload";

/** One exam: every question's result per student, added up, with points imported from elsewhere beside them. */
export default function ExamScreen({ examId }: { examId: number }) {
  const queryClient = useQueryClient();
  const results = useQuery({
    queryKey: ["exam", examId],
    queryFn: () => api<ExamResults>(`/exams/${examId}/results`),
    // while a question is still being judged, its column fills in on its own
    refetchInterval: (q) => (q.state.data?.columns.some((c) => c.stage === "grading") ? 3000 : false),
  });
  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const removeImport = useMutation({
    mutationFn: (partId: number) => api(`/imports/${partId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exam", examId] }),
    onError: (e) => toast.error(e instanceof ApiError ? String(e.detail) : "삭제하지 못했습니다"),
  });

  if (results.error) {
    const e = results.error;
    return <p className="text-destructive">{e instanceof ApiError ? String(e.detail) : "불러오지 못했습니다"}</p>;
  }
  if (!results.data) return <p className="text-muted-foreground">불러오는 중…</p>;
  const r = results.data;
  const questions = r.columns.filter((c) => c.kind === "question");
  const finalized = questions.filter((c) => c.stage === "finalized").length;
  const totals = r.students.map((s) => s.total).filter((t): t is number => t !== null);
  const average = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;

  return (
    <div className="flex flex-col gap-4">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          과목
        </Link>{" "}
        › {termLabel(r.course.term)} ›{" "}
        <Link href={`/courses/${r.course.id}`} className="hover:underline">
          {r.course.name} ({r.course.section}분반)
        </Link>
      </nav>

      <header className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{r.exam.name} · 시험 결과</h1>
          <p className="text-sm text-muted-foreground">
            {r.finalized ? (
              <span className="text-emerald-700 dark:text-emerald-400">✓ 모든 문항의 성적을 확정했습니다</span>
            ) : (
              `서술형 ${questions.length}문항 중 ${finalized}문항 성적 확정`
            )}
            {` · 학생 ${r.students.length}명`}
            {average !== null && ` · 합계를 낸 ${totals.length}명 평균 ${average.toFixed(1)}점`}
          </p>
          {!r.finalized && <GradesDue term={r.course.term} question={{ examName: r.exam.name }} className="self-start" />}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!questions.some((q) => q.number !== null)}
            title="학생마다 시험 전체 답안지를 올리면 문항별로 나눠 넣습니다"
            onClick={() => setUploading(true)}
          >
            답안지 올리기
          </Button>
          <Button variant="outline" onClick={() => setImporting(true)}>
            다른 곳에서 채점한 점수 가져오기
          </Button>
          <ExportButton variant="default" csvHref={`${API_URL}/exams/${examId}/export.csv`} printPath={`/exams/${examId}/print`} />
        </div>
      </header>

      {r.columns.length === 0 ? (
        <div className="rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
          아직 이 시험에 문항이 없습니다.{" "}
          <Link href={`/courses/${r.course.id}/assignments/new?exam=${examId}`} className="text-primary underline-offset-4 hover:underline">
            문항 추가
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card px-2 shadow-xs ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>학번</TableHead>
                <TableHead>이름</TableHead>
                {r.columns.map((c) => (
                  <TableHead key={`${c.kind}-${c.id}`} className="text-right align-bottom">
                    <ColumnHead column={c} onRemove={() => confirm(`가져온 '${c.title}' 점수를 지울까요?`) && removeImport.mutate(c.id)} />
                  </TableHead>
                ))}
                <TableHead className="text-right align-bottom">
                  합계 <span className="font-normal text-muted-foreground">/ {formatPoints(r.max_points)}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.students.map((s) => (
                <TableRow key={s.student_ref}>
                  <TableCell className="tabular-nums">{s.student_ref}</TableCell>
                  <TableCell>{s.student_name ?? <span className="text-muted-foreground">-</span>}</TableCell>
                  {s.cells.map((cell, i) => (
                    <TableCell key={i} className="text-right tabular-nums">
                      {!cell.submitted ? (
                        <span className="text-xs text-muted-foreground" title="이 학생의 답안(또는 가져온 점수)이 없어 0점으로 합산합니다">
                          미제출
                        </span>
                      ) : cell.points === null ? (
                        <span className="text-muted-foreground" title="아직 확정하지 않은 항목이 있습니다">
                          –
                        </span>
                      ) : (
                        formatPoints(cell.points)
                      )}
                    </TableCell>
                  ))}
                  <TableCell className={cn("text-right font-semibold tabular-nums", s.total === null && "font-normal text-muted-foreground")}>
                    {s.total === null ? "채점 중" : formatPoints(s.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        학번으로 문항별 결과를 묶습니다. 답안이 없는 문항은 0점으로 더하고, 확정하지 않은 문항이 있는 학생은 합계를 비워 둡니다.
      </p>

      {uploading && (
        <SheetUpload
          examId={examId}
          questions={questions.filter((q) => q.number !== null)}
          answered={answeredBy(r)}
          onClose={() => setUploading(false)}
        />
      )}
      {importing && <ImportDialog examId={examId} onClose={() => setImporting(false)} />}
    </div>
  );
}

function ColumnHead({ column: c, onRemove }: { column: ExamColumn; onRemove: () => void }) {
  if (c.kind === "imported")
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-foreground">
          {c.title} <span className="font-normal text-muted-foreground">/ {formatPoints(c.max_points)}</span>
        </span>
        <span className="flex items-center gap-1 font-normal">
          <Badge variant="outline">가져온 점수</Badge>
          <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={onRemove}>
            지우기
          </button>
        </span>
      </div>
    );
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Link href={`/assignments/${c.id}`} className="text-foreground hover:underline">
        {c.number !== null && `${c.number}번 `}
        {c.title} <span className="font-normal text-muted-foreground">/ {formatPoints(c.max_points)}</span>
      </Link>
      {c.stage && <Badge variant={STAGE_VARIANT[c.stage]}>{STAGE_LABEL[c.stage] ?? c.stage}</Badge>}
    </div>
  );
}

/** Points graded elsewhere (multiple choice, calculation; LMS, OMR, by hand): a CSV of 학번 and 점수 becomes one more column. */
function ImportDialog({ examId, onClose }: { examId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("객관식");
  const [maxPoints, setMaxPoints] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("file", file!);
      form.append("title", title.trim());
      form.append("max_points", maxPoints);
      return api<ExamColumn>(`/exams/${examId}/imports`, { method: "POST", body: form });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam", examId] });
      toast.success("점수를 가져왔습니다");
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && typeof e.detail === "string" ? e.detail : "가져오지 못했습니다"),
  });
  const valid = title.trim() && Number(maxPoints) > 0 && file;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>다른 곳에서 채점한 점수 가져오기</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) upload.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">
            객관식이나 계산 문항처럼 LMS·OMR 또는 직접 채점한 점수를 시험 결과에 한 열로 더합니다. 열: 학번, 점수, 선택 이름. UTF-8 또는 CP949.
          </p>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <label className="flex flex-col gap-1 text-sm">
              열 이름
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              만점
              <Input type="number" min={0} step="any" placeholder="20" value={maxPoints} onChange={(e) => setMaxPoints(e.target.value)} />
            </label>
          </div>
          <Input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <DialogFooter>
            <Button type="submit" disabled={!valid || upload.isPending}>
              {upload.isPending ? "가져오는 중…" : "가져오기"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, type AssignmentOut, type GradingStatus, type RubricItemOut, type SubmissionOut } from "@/lib/api";
import { itemName, KIND_HINT, KIND_LABEL, plain, TYPE_LABEL } from "@/lib/rubric";
import ReadAnswer from "./read-answer";

const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? String(e.detail) : fallback);

/** Setup work: rubric, answer upload, grading run, deletion. */
export default function AdminPanel({
  assignment,
  onGradingStarted,
  onOpenStudent,
}: {
  assignment: AssignmentOut;
  onGradingStarted: () => void;
  onOpenStudent: (submissionId: number) => void; // an answer added and graded on its own
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`/assignments/${assignment.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      queryClient.invalidateQueries({ queryKey: ["course", assignment.course_id] });
      router.push(`/courses/${assignment.course_id}`);
    },
    onError: (e) => toast.error(errorMessage(e, "삭제하지 못했습니다")),
  });

  return (
    <div className="flex flex-col gap-6 pt-2">
      {/* in working order: criteria, answers, then the grading run */}
      <RubricCard assignment={assignment} />
      <SubmissionsCard assignmentId={assignment.id} onOpenStudent={onOpenStudent} />
      <GradingCard assignmentId={assignment.id} submissionCount={assignment.submission_count} onStarted={onGradingStarted} />
      <div className="flex justify-end">
        <Button
          variant="destructive"
          size="sm"
          disabled={remove.isPending}
          onClick={() => confirm("문항과 답안, 채점 결과를 모두 삭제할까요?") && remove.mutate()}
        >
          문항 삭제
        </Button>
      </div>
    </div>
  );
}

function RubricCard({ assignment }: { assignment: AssignmentOut }) {
  const items = assignment.items.filter((i) => i.kind !== "gate"); // the topic check is always there
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle>채점 기준</CardTitle>
        {assignment.progress.cells === 0 ? (
          <Link
            href={`/assignments/${assignment.id}/edit`}
            className={`ml-auto ${buttonVariants({ variant: "outline", size: "sm" })}`}
          >
            문항·기준 수정
          </Link>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">채점이 시작되어 기준을 수정할 수 없습니다</span>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>항목</TableHead>
              <TableHead>구분</TableHead>
              <TableHead>AI가 확인할 내용</TableHead>
              <TableHead className="text-right">배점</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium" title={item.key}>
                    {itemName(item)}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" title={KIND_HINT[item.kind]}>
                    {KIND_LABEL[item.kind]}
                  </Badge>{" "}
                  <span className="text-muted-foreground">{TYPE_LABEL[item.type] ?? item.type}</span>
                </TableCell>
                <TableCell className="whitespace-normal">{plain(item.instructions)}</TableCell>
                <TableCell className="text-right">{pointsLabel(item)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="pt-2 text-xs text-muted-foreground">
          빈 답안이나 문제와 관련 없는 답안은 AI가 알아보고 모든 항목에 0점을 추천합니다.
        </p>
      </CardContent>
    </Card>
  );
}

function pointsLabel(item: RubricItemOut): string {
  if (item.kind === "gate") return "—";
  if (item.kind === "deduction") return `−${item.points}`;
  if (item.points !== null) return String(item.points);
  return Object.values(item.points_map ?? {}).join(" / ");
}

function GradingCard({
  assignmentId,
  submissionCount,
  onStarted,
}: {
  assignmentId: number;
  submissionCount: number;
  onStarted: () => void;
}) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["grading", assignmentId],
    queryFn: () => api<GradingStatus>(`/assignments/${assignmentId}/grading`),
    refetchInterval: (q) => (q.state.data && !q.state.data.done ? 2000 : false),
  });
  const grade = useMutation({
    // only_new: answers added after grading started, leaving every existing decision as it is
    mutationFn: (onlyNew: boolean) =>
      api<GradingStatus>(`/assignments/${assignmentId}/grade${onlyNew ? "?only_new=true" : ""}`, { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(["grading", assignmentId], data);
      queryClient.invalidateQueries({ queryKey: ["cells", assignmentId] });
      queryClient.invalidateQueries({ queryKey: ["results", assignmentId] });
      // first judgments are in: go grade while the LLM re-judges the rest in the background
      onStarted();
    },
    onError: (e) => toast.error(errorMessage(e, "채점을 시작하지 못했습니다")),
  });

  const s = status.data;
  const graded = !!s && s.total > 0;
  const start = () => {
    if (graded && !confirm("기존 판단과 추천을 지우고 다시 채점할까요? 확정한 항목이 있으면 다시 채점할 수 없습니다.")) return;
    grade.mutate(false);
  };
  const fresh = s?.ungraded ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle>채점</CardTitle>
        <div className="ml-auto flex gap-2">
          {/* once graded, going to grade is the next step; re-grading is the rare one */}
          <Button
            variant={graded ? "outline" : "default"}
            disabled={submissionCount === 0 || grade.isPending || (graded && !s.done)}
            onClick={start}
          >
            {grade.isPending ? "판단 중…" : graded ? "다시 채점" : "채점 시작"}
          </Button>
          {graded && fresh > 0 ? (
            <Button disabled={grade.isPending} onClick={() => grade.mutate(true)}>
              {grade.isPending ? "판단 중…" : `새 답안 ${fresh}건 채점`}
            </Button>
          ) : (
            graded && <Button onClick={onStarted}>채점하러 가기</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {submissionCount === 0 && <p className="text-muted-foreground">답안을 먼저 올리세요.</p>}
        {graded && fresh > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            채점을 시작한 뒤 추가한 답안 {fresh}건이 아직 판단 전입니다. &ldquo;새 답안 {fresh}건 채점&rdquo;은 이 답안만 판단하고, 이미 확정한
            항목은 그대로 둡니다.
          </p>
        )}
        {graded && (
          <>
            <Progress value={((s.total - s.pending) / s.total) * 100} />
            <p className="text-sm">
              {s.done
                ? "모든 답안의 항목에 추천을 만들었습니다. 채점 탭에서 확인이 필요한 항목부터 보세요."
                : `AI가 ${s.pending}개 항목을 다시 보는 중입니다 (전체 ${s.total}개). 기다리는 동안 채점을 시작해도 됩니다.`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const PREVIEW_ROWS = 5; // a long class list buries the grading card below it

function SubmissionsCard({ assignmentId, onOpenStudent }: { assignmentId: number; onOpenStudent: (submissionId: number) => void }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [showAll, setShowAll] = useState(false);
  const [reading, setReading] = useState(false);
  const status = useQuery({
    queryKey: ["grading", assignmentId],
    queryFn: () => api<GradingStatus>(`/assignments/${assignmentId}/grading`),
  });
  const submissions = useQuery({
    queryKey: ["submissions", assignmentId],
    queryFn: () => api<SubmissionOut[]>(`/assignments/${assignmentId}/submissions`),
  });
  const refresh = () => {
    for (const key of ["submissions", "assignment", "grading", "cells", "results"]) {
      queryClient.invalidateQueries({ queryKey: [key, assignmentId] });
    }
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<SubmissionOut[]>(`/assignments/${assignmentId}/submissions/csv`, { method: "POST", body: form });
    },
    onSuccess: (created) => {
      toast.success(`답안 ${created.length}개를 올렸습니다`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "업로드하지 못했습니다")),
    onSettled: () => {
      if (fileInput.current) fileInput.current.value = "";
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/submissions/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e, "삭제하지 못했습니다")),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle>답안 {submissions.data && `(${submissions.data.length})`}</CardTitle>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setReading(true)}>
            종이 답안·문서로 추가
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
          />
          <Button variant="outline" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
            {upload.isPending ? "올리는 중…" : "CSV 올리기"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          열: 학번, 답안, 선택 이름 (영문 <code>student_id</code>, <code>answer</code>, <code>name</code>도 됨). AI에는 이름·학번
          등 식별 정보를 지운 답안만 보냅니다. 채점 화면에서 이름을 가리고 채점할 수도 있습니다. UTF-8 또는 CP949.{" "}
          <a href="/answers_template.csv" download className="underline underline-offset-2">
            예시 CSV
          </a>
        </p>
        {submissions.data?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>학생</TableHead>
                <TableHead>AI에 보내는 답안 (식별 정보 제거됨)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(showAll ? submissions.data : submissions.data.slice(0, PREVIEW_ROWS)).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="align-top whitespace-nowrap">
                    {s.student_name ?? s.student_ref}
                    {s.student_name && <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{s.student_ref}</span>}
                  </TableCell>
                  <TableCell className="max-w-xl truncate">{s.clean_text || <span className="text-muted-foreground">(빈 답안)</span>}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => confirm(`${s.student_name ?? s.student_ref} 답안을 삭제할까요?`) && remove.mutate(s.id)}
                    >
                      삭제
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground">아직 올린 답안이 없습니다.</p>
        )}
        {(submissions.data?.length ?? 0) > PREVIEW_ROWS && (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setShowAll(!showAll)}>
            {showAll ? "접기" : `${submissions.data!.length}건 모두 보기`}
          </Button>
        )}
      </CardContent>
      {reading && (
        <ReadAnswer
          assignmentId={assignmentId}
          graded={(status.data?.total ?? 0) > 0}
          onClose={() => setReading(false)}
          onGraded={onOpenStudent}
        />
      )}
    </Card>
  );
}

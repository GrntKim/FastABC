"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, type AssignmentOut, type GradingStatus, type RubricItemOut, type SubmissionOut } from "@/lib/api";
import { itemName, KIND_HINT, KIND_LABEL, plain, ROUTE_LABEL, TYPE_LABEL } from "@/lib/rubric";

const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? String(e.detail) : fallback);

/** Setup work: rubric, answer upload, grading run, deletion. */
export default function AdminPanel({ assignment }: { assignment: AssignmentOut }) {
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
      <GradingCard assignmentId={assignment.id} submissionCount={assignment.submission_count} />
      <SubmissionsCard assignmentId={assignment.id} />
      <RubricCard assignment={assignment} />
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
  const items = assignment.items;
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
              <TableHead>판단 질문</TableHead>
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

function GradingCard({ assignmentId, submissionCount }: { assignmentId: number; submissionCount: number }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["grading", assignmentId],
    queryFn: () => api<GradingStatus>(`/assignments/${assignmentId}/grading`),
    refetchInterval: (q) => (q.state.data && !q.state.data.done ? 2000 : false),
  });
  const grade = useMutation({
    mutationFn: () => api<GradingStatus>(`/assignments/${assignmentId}/grade`, { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(["grading", assignmentId], data);
      queryClient.invalidateQueries({ queryKey: ["cells", assignmentId] });
      queryClient.invalidateQueries({ queryKey: ["results", assignmentId] });
    },
    onError: (e) => toast.error(errorMessage(e, "채점을 시작하지 못했습니다")),
  });

  const s = status.data;
  const graded = !!s && s.total > 0;
  const start = () => {
    if (graded && !confirm("기존 판단과 추천을 지우고 다시 채점할까요? 확정한 칸이 있으면 재채점할 수 없습니다.")) return;
    grade.mutate();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle>채점</CardTitle>
        <div className="ml-auto flex gap-2">
          <Button disabled={submissionCount === 0 || grade.isPending || (graded && !s.done)} onClick={start}>
            {grade.isPending ? "판단 중…" : graded ? "다시 채점" : "채점 시작"}
          </Button>
          {graded && (
            <Link href={`/assignments/${assignmentId}/review`} className={buttonVariants({ variant: "outline" })}>
              검토하기
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {submissionCount === 0 && <p className="text-muted-foreground">답안을 먼저 올리세요.</p>}
        {graded && (
          <>
            <Progress value={((s.total - s.pending) / s.total) * 100} />
            <p className="text-sm">
              {s.done ? "판단 완료" : `LLM 재판단 진행 중 (${s.pending}칸 남음)`} · 전체 {s.total}칸
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(s.routes).map(([route, count]) => (
                <Badge key={route} variant="secondary">
                  {ROUTE_LABEL[route] ?? route} {count}
                </Badge>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SubmissionsCard({ assignmentId }: { assignmentId: number }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
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
        <div className="ml-auto">
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
          열: <code>student_id</code>, <code>answer</code>, 선택 <code>name</code> (식별 정보 제거에만 쓰고 저장하지 않음). UTF-8 또는 CP949.
        </p>
        {submissions.data?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>라벨</TableHead>
                <TableHead>답안 (식별 정보 제거됨)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono align-top">{s.label}</TableCell>
                  <TableCell className="max-w-xl truncate">{s.clean_text || <span className="text-muted-foreground">(빈 답안)</span>}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => confirm(`${s.label} 답안을 삭제할까요?`) && remove.mutate(s.id)}
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
      </CardContent>
    </Card>
  );
}

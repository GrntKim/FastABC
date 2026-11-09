"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { progressSegments, SegmentBar } from "@/components/segment-bar";
import { StepList, type Step } from "@/components/step-list";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, type CourseOut } from "@/lib/api";
import { nextAction, STAGE_LABEL, STAGE_VARIANT, termLabel } from "@/lib/progress";
import CourseForm from "../../course-form";

const ASSIGNMENT_STEPS: Step[] = [
  { title: "문제와 채점 기준", body: "평소 쓰던 채점 기준 문장을 붙여 넣으면 AI가 항목으로 나눕니다. 확인하고 고친 뒤 저장합니다." },
  { title: "답안 올리고 채점 시작", body: "답안 CSV를 올리고 채점을 시작하면, AI가 모든 항목을 판단해 확인할 곳을 표시합니다." },
  { title: "확인하고 성적 확정", body: "확인이 필요한 항목만 보고, 나머지는 한 번에 확정합니다. 끝나면 성적을 확정해 잠급니다." },
];

/** One course section: its questions, where each one stands, and what to do next. */
export default function CourseScreen({ courseId }: { courseId: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const course = useQuery({ queryKey: ["course", courseId], queryFn: () => api<CourseOut>(`/courses/${courseId}`) });
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/courses/${courseId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      router.push("/");
    },
    onError: (e) => toast.error(e instanceof ApiError ? String(e.detail) : "삭제하지 못했습니다"),
  });

  if (course.error) {
    const e = course.error;
    return <p className="text-destructive">{e instanceof ApiError ? String(e.detail) : "불러오지 못했습니다"}</p>;
  }
  if (!course.data) return <p className="text-muted-foreground">불러오는 중…</p>;
  const c = course.data;

  return (
    <div className="flex flex-col gap-4">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          과목
        </Link>{" "}
        › {termLabel(c.term)}
      </nav>

      <header className="flex flex-wrap items-start gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <p className="text-sm text-muted-foreground">{c.department}</p>
          <h1 className="text-2xl font-bold">
            {c.name} <span className="font-normal text-muted-foreground">· {c.section}분반</span>
          </h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          과목 수정
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={remove.isPending}
          onClick={() =>
            confirm(`${c.name} ${c.section}분반의 문항 ${c.assignment_count}개와 답안·채점 결과를 모두 삭제할까요?`) &&
            remove.mutate()
          }
        >
          과목 삭제
        </Button>
      </header>

      <div className="flex items-center">
        <h2 className="text-lg font-semibold">문항</h2>
        <Link href={`/courses/${courseId}/assignments/new`} className={`ml-auto ${buttonVariants()}`}>
          문항 추가
        </Link>
      </div>

      {c.assignments.length === 0 ? (
        <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p>아직 문항이 없습니다. 문항 하나는 이렇게 채점합니다.</p>
          <StepList steps={ASSIGNMENT_STEPS} />
          <Link href={`/courses/${courseId}/assignments/new`} className={`self-start ${buttonVariants()}`}>
            첫 문항 만들기
          </Link>
        </div>
      ) : (
        <div className="rounded-xl bg-card px-2 shadow-xs ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>문항</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="w-56">진행</TableHead>
                <TableHead className="text-right">답안</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.assignments.map((a) => {
                const p = a.progress;
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      {a.assessment && <div className="text-xs text-muted-foreground">{a.assessment}</div>}
                      <Link href={`/assignments/${a.id}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STAGE_VARIANT[p.stage]}>{STAGE_LABEL[p.stage] ?? p.stage}</Badge>
                    </TableCell>
                    <TableCell>
                      {p.cells > 0 && (
                        <div className="flex flex-col gap-1">
                          <SegmentBar
                            segments={progressSegments(
                              p.decided,
                              p.cells - p.decided - p.attention - p.pending,
                              p.attention + p.pending,
                            )}
                          />
                          <span className="text-xs text-muted-foreground">
                            학생 {p.students_done} / {p.submissions}명 완료
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{p.submissions}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/assignments/${a.id}`}
                        className={buttonVariants({ size: "sm", variant: p.attention ? "default" : "outline" })}
                      >
                        {nextAction(a)}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && <CourseForm open={editing} onOpenChange={setEditing} course={c} />}
    </div>
  );
}

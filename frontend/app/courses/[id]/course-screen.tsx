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
import { api, ApiError, type AssignmentSummary, type CourseOut, type ExamRef } from "@/lib/api";
import { nextAction, STAGE_LABEL, STAGE_VARIANT, termLabel } from "@/lib/progress";
import CourseForm from "../../course-form";
import ExamForm from "./exam-form";

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
  const [examForm, setExamForm] = useState<{ exam?: ExamRef } | null>(null);
  const removeExam = useMutation({
    mutationFn: (examId: number) => api(`/exams/${examId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course", courseId] }),
    onError: (e) => toast.error(e instanceof ApiError ? String(e.detail) : "삭제하지 못했습니다"),
  });
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

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">시험과 문항</h2>
        <Button variant="outline" className="ml-auto" onClick={() => setExamForm({})}>
          시험 추가
        </Button>
        <Link href={`/courses/${courseId}/assignments/new`} className={buttonVariants()}>
          문항 추가
        </Link>
      </div>

      {c.assignments.length === 0 && c.exams.length === 0 ? (
        <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p>아직 문항이 없습니다. 문항 하나는 이렇게 채점합니다.</p>
          <StepList steps={ASSIGNMENT_STEPS} />
          <p className="text-sm text-muted-foreground">
            중간고사처럼 여러 문항을 묶으려면 먼저 시험을 추가하세요. 시험 결과에서 학생별 합계를 보고, 객관식 점수도 가져올 수 있습니다.
          </p>
          <Link href={`/courses/${courseId}/assignments/new`} className={`self-start ${buttonVariants()}`}>
            첫 문항 만들기
          </Link>
        </div>
      ) : (
        <>
          {c.exams.map((exam) => {
            const questions = c.assignments
              .filter((a) => a.exam_id === exam.id)
              .sort((x, y) => (x.number ?? 99) - (y.number ?? 99));
            return (
              <section key={exam.id} className="flex flex-col gap-2 rounded-xl bg-card p-3 shadow-xs ring-1 ring-foreground/10">
                <div className="flex flex-wrap items-center gap-2 px-1">
                  <h3 className="text-base font-semibold">{exam.name}</h3>
                  <span className="text-sm text-muted-foreground">문항 {questions.length}개</span>
                  <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setExamForm({ exam })}>
                    이름 바꾸기
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() =>
                      confirm(`시험 '${exam.name}'을 삭제할까요? 문항과 채점 결과는 과목에 남고, 가져온 객관식 점수는 지워집니다.`) &&
                      removeExam.mutate(exam.id)
                    }
                  >
                    삭제
                  </Button>
                  <Link
                    href={`/courses/${courseId}/assignments/new?exam=${exam.id}`}
                    className={`ml-auto ${buttonVariants({ size: "sm", variant: "ghost" })}`}
                  >
                    + 이 시험에 문항 추가
                  </Link>
                  <Link href={`/exams/${exam.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                    시험 결과 →
                  </Link>
                </div>
                {questions.length > 0 ? (
                  <QuestionTable questions={questions} />
                ) : (
                  <p className="px-1 pb-1 text-sm text-muted-foreground">아직 문항이 없습니다.</p>
                )}
              </section>
            );
          })}
          {c.assignments.some((a) => a.exam_id === null) && (
            <section className="flex flex-col gap-2 rounded-xl bg-card p-3 shadow-xs ring-1 ring-foreground/10">
              <h3 className="px-1 text-base font-semibold text-muted-foreground">시험에 넣지 않은 문항</h3>
              <QuestionTable questions={c.assignments.filter((a) => a.exam_id === null)} />
            </section>
          )}
        </>
      )}

      {examForm && <ExamForm courseId={courseId} exam={examForm.exam} onClose={() => setExamForm(null)} />}
      {editing && <CourseForm open={editing} onOpenChange={setEditing} course={c} />}
    </div>
  );
}

/** The questions of one exam: where each stands and what to do next. */
function QuestionTable({ questions }: { questions: AssignmentSummary[] }) {
  return (
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
        {questions.map((a) => {
          const p = a.progress;
          return (
            <TableRow key={a.id}>
              <TableCell>
                <Link href={`/assignments/${a.id}`} className="font-medium hover:underline">
                  {a.number !== null && <span className="mr-1.5 text-muted-foreground">{a.number}번</span>}
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
                      segments={progressSegments(p.decided, p.cells - p.decided - p.attention - p.pending, p.attention + p.pending)}
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
  );
}

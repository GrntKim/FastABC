"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { ReportSheets, useReports, type ReportPage } from "@/components/student-report";
import { api, ApiError, type AssignmentOut, type ExamResults } from "@/lib/api";

/**
 * Grading reports for an exam: each student's signed-off questions, points imported from elsewhere, and
 * the total once every question is signed off. Every student, or `student` alone.
 */
export default function ExamReport({ examId, student }: { examId: number; student: string | null }) {
  const results = useQuery({ queryKey: ["exam", examId], queryFn: () => api<ExamResults>(`/exams/${examId}/results`) });
  const columns = results.data?.columns ?? [];
  const signed = columns.filter((c) => c.kind === "question" && c.stage === "finalized").map((c) => c.id);
  const assignments = useQueries({
    queries: signed.map((id) => ({ queryKey: ["assignment", id], queryFn: () => api<AssignmentOut>(`/assignments/${id}`) })),
  });
  const { looking, reports, error } = useReports(signed, student);

  if (results.error || error) {
    const e = results.error ?? error;
    return <p className="text-destructive">{e instanceof ApiError ? String(e.detail) : "근거표를 만들지 못했습니다"}</p>;
  }
  if (!results.data || !reports || assignments.some((a) => !a.data))
    return <p className="text-muted-foreground">{looking ? "확인하지 않은 답안의 근거 문장을 찾는 중… (답안당 몇 초)" : "불러오는 중…"}</p>;
  const r = results.data;
  if (!signed.length) return <p className="text-muted-foreground">성적을 확정한 문항이 없어 근거표를 만들 수 없습니다.</p>;

  const allSigned = columns.every((c) => c.kind !== "question" || c.stage === "finalized");
  const pages: ReportPage[] = r.students
    .filter((s) => !student || s.student_ref === student)
    .map((s) => ({
      ref: s.student_ref,
      name: s.student_name,
      questions: columns.flatMap((c) => {
        if (c.kind !== "question") return [];
        const at = signed.indexOf(c.id);
        if (at === -1) return [{ key: c.id, number: c.number, title: c.title, max: c.max_points }];
        return [
          {
            key: c.id,
            number: c.number,
            title: c.title,
            max: c.max_points,
            assignment: assignments[at].data!,
            finalization: reports[at].finalization,
            answer: reports[at].students.find((x) => x.student_ref === s.student_ref) ?? null,
          },
        ];
      }),
      extras: columns.flatMap((c, i) =>
        c.kind === "imported" ? [{ title: c.title, points: s.cells[i]?.submitted ? (s.cells[i].points ?? null) : null, max: c.max_points }] : [],
      ),
      total: allSigned ? s.total : null,
      maxTotal: r.max_points,
    }));
  return <ReportSheets course={r.course} heading={r.exam.name} pages={pages} />;
}

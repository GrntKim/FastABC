"use client";

import { useQuery } from "@tanstack/react-query";
import { ReportSheets, useReports } from "@/components/student-report";
import { api, ApiError, type AssignmentOut } from "@/lib/api";

/** Grading reports for one signed-off question: every student, or `student` alone. */
export default function QuestionReport({ assignmentId, student }: { assignmentId: number; student: string | null }) {
  const assignment = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api<AssignmentOut>(`/assignments/${assignmentId}`),
  });
  const { looking, reports, error } = useReports([assignmentId], student);

  if (error) return <p className="text-destructive">{error instanceof ApiError ? String(error.detail) : "근거표를 만들지 못했습니다"}</p>;
  if (!assignment.data || !reports)
    return <p className="text-muted-foreground">{looking ? "확인하지 않은 답안의 근거 문장을 찾는 중… (답안당 몇 초)" : "불러오는 중…"}</p>;

  const a = assignment.data;
  const r = reports[0];
  const max = r.max_points;
  const pages = r.students.map((s) => ({
    ref: s.student_ref,
    name: s.student_name,
    questions: [{ key: a.id, number: a.number, title: a.title, max, assignment: a, finalization: r.finalization, answer: s }],
    extras: [],
    total: s.total,
    maxTotal: max,
  }));
  return <ReportSheets course={a.course} heading={a.assessment ? `${a.assessment} ${a.title}` : a.title} pages={pages} />;
}

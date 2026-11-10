"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { GradeSheet, signOffRecord } from "@/components/grade-sheet";
import type { NameMode, SheetKind } from "@/lib/sheet";
import { api, type ExamResults, type FinalizationOut } from "@/lib/api";

/** A whole exam as a printable grade list: every question and imported column, then the total. */
export default function ExamPrint({ examId, kind, names }: { examId: number; kind: SheetKind; names: NameMode }) {
  const results = useQuery({
    queryKey: ["exam", examId],
    queryFn: () => api<ExamResults>(`/exams/${examId}/results`),
  });
  const questions = results.data?.columns.filter((c) => c.kind === "question") ?? [];
  const histories = useQueries({
    queries: questions.map((c) => ({
      queryKey: ["finalizations", c.id],
      queryFn: () => api<FinalizationOut[]>(`/assignments/${c.id}/finalizations`),
    })),
  });
  if (!results.data || histories.some((h) => !h.data)) return <p className="text-muted-foreground">불러오는 중…</p>;

  const r = results.data;
  const title = (c: ExamResults["columns"][number]) => (c.number !== null ? `${c.number}번 ${c.title}` : c.title);
  const records = r.columns.map((c) => {
    if (c.kind === "imported") return { title: title(c), text: "다른 곳에서 채점한 점수를 가져옴" };
    const i = questions.findIndex((q) => q.id === c.id);
    return signOffRecord(title(c), c.stage === "finalized", histories[i].data?.[0]);
  });
  return (
    <GradeSheet
      kind={kind}
      names={names}
      heading={r.exam.name}
      course={r.course}
      columns={r.columns.map((c) => ({ title: title(c), max: c.max_points }))}
      maxTotal={r.max_points}
      rows={r.students.map((s) => ({
        ref: s.student_ref,
        name: s.student_name,
        cells: s.cells.map((c) => (!c.submitted ? "missing" : c.points)),
        total: s.total,
      }))}
      finalized={r.finalized}
      records={records}
    />
  );
}

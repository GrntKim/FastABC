"use client";

import { useQuery } from "@tanstack/react-query";
import { GradeSheet, signOffRecord } from "@/components/grade-sheet";
import type { NameMode, SheetKind } from "@/lib/sheet";
import { api, type AssignmentOut, type FinalizationOut, type SubmissionResult } from "@/lib/api";

/** One question's totals as a printable grade list. */
export default function QuestionPrint({ assignmentId, kind, names }: { assignmentId: number; kind: SheetKind; names: NameMode }) {
  const assignment = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api<AssignmentOut>(`/assignments/${assignmentId}`),
  });
  const results = useQuery({
    queryKey: ["results", assignmentId],
    queryFn: () => api<SubmissionResult[]>(`/assignments/${assignmentId}/results`),
  });
  const history = useQuery({
    queryKey: ["finalizations", assignmentId],
    queryFn: () => api<FinalizationOut[]>(`/assignments/${assignmentId}/finalizations`),
  });
  if (!assignment.data || !results.data || !history.data) return <p className="text-muted-foreground">불러오는 중…</p>;

  const a = assignment.data;
  const finalized = a.progress.stage === "finalized";
  const heading = a.assessment ? `${a.assessment} ${a.title}` : a.title;
  const rows = [...results.data]
    .sort((x, y) => x.student_ref.localeCompare(y.student_ref))
    .map((r) => ({ ref: r.student_ref, name: r.student_name, cells: [], total: r.total }));
  return (
    <GradeSheet
      kind={kind}
      names={names}
      heading={heading}
      course={a.course}
      columns={[]}
      maxTotal={results.data[0]?.max_points ?? 0}
      rows={rows}
      finalized={finalized}
      records={[signOffRecord(heading, finalized, history.data[0])]}
    />
  );
}

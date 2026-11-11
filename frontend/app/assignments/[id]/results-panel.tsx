"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ExportButton } from "@/components/export-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, API_URL, type SubmissionResult } from "@/lib/api";

// The only place student ids are shown: the review cards use anonymous labels
export default function ResultsPanel({ assignmentId, signed = false }: { assignmentId: number; signed?: boolean }) {
  const results = useQuery({
    queryKey: ["results", assignmentId],
    queryFn: () => api<SubmissionResult[]>(`/assignments/${assignmentId}/results`),
  });
  if (!results.data) return <p className="text-muted-foreground pt-2">불러오는 중…</p>;

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex justify-end">
        <ExportButton
          size="sm"
          csvHref={`${API_URL}/assignments/${assignmentId}/export.csv`}
          printPath={`/assignments/${assignmentId}/print`}
          reportPath={`/assignments/${assignmentId}/report`}
          reportReady={signed}
        />
      </div>
      <div className="rounded-xl bg-card px-2 shadow-xs ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>학번</TableHead>
              <TableHead>이름</TableHead>
              <TableHead>라벨</TableHead>
              <TableHead className="text-right">확정</TableHead>
              <TableHead className="text-right">총점</TableHead>
              {signed && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.data.map((r) => (
              <TableRow key={r.submission_id}>
                <TableCell className="tabular-nums">{r.student_ref}</TableCell>
                <TableCell>{r.student_name ?? <span className="text-muted-foreground">-</span>}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{r.label}</TableCell>
                <TableCell className="text-right">
                  {r.decided} / {r.cells}
                </TableCell>
                <TableCell className="text-right">
                  {r.total === null ? <span className="text-muted-foreground">미완료</span> : `${r.total} / ${r.max_points}`}
                </TableCell>
                {signed && (
                  <TableCell className="text-right">
                    {/* what goes back to this student when they ask why */}
                    <Link
                      href={`/assignments/${assignmentId}/report?student=${encodeURIComponent(r.student_ref)}`}
                      target="_blank"
                      className="text-xs text-primary underline-offset-4 hover:underline"
                    >
                      근거표
                    </Link>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

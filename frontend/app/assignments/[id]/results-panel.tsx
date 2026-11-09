"use client";

import { useQuery } from "@tanstack/react-query";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, API_URL, type SubmissionResult } from "@/lib/api";

// The only place student ids are shown: the review cards use anonymous labels
export default function ResultsPanel({ assignmentId }: { assignmentId: number }) {
  const results = useQuery({
    queryKey: ["results", assignmentId],
    queryFn: () => api<SubmissionResult[]>(`/assignments/${assignmentId}/results`),
  });
  if (!results.data) return <p className="text-muted-foreground pt-2">불러오는 중…</p>;

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex justify-end">
        <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`${API_URL}/assignments/${assignmentId}/export.csv`}>
          CSV 내보내기
        </a>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, type AssignmentSummary } from "@/lib/api";

export default function AssignmentsList() {
  const assignments = useQuery({
    queryKey: ["assignments"],
    queryFn: () => api<AssignmentSummary[]>("/assignments"),
  });

  if (assignments.error) {
    const e = assignments.error;
    return <p className="text-destructive">{e instanceof ApiError ? String(e.detail) : "백엔드에 연결하지 못했습니다"}</p>;
  }
  if (!assignments.data) return <p className="text-muted-foreground">불러오는 중…</p>;
  if (assignments.data.length === 0) {
    return (
      <p className="text-muted-foreground">
        문항이 없습니다. <Link href="/assignments/new" className="underline">새 문항</Link>을 만드세요.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>제목</TableHead>
          <TableHead className="text-right">답안</TableHead>
          <TableHead className="text-right">만점</TableHead>
          <TableHead>만든 날</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {assignments.data.map((a) => (
          <TableRow key={a.id}>
            <TableCell>
              <Link href={`/assignments/${a.id}`} className="font-medium hover:underline">
                {a.title}
              </Link>
            </TableCell>
            <TableCell className="text-right">{a.submission_count}</TableCell>
            <TableCell className="text-right">{a.max_points}</TableCell>
            <TableCell>{new Date(a.created_at).toLocaleDateString("ko-KR")}</TableCell>
            <TableCell className="text-right">
              <Link href={`/assignments/${a.id}/review`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                검토
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

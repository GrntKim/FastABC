"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError, type AssignmentOut, type GradingStatus } from "@/lib/api";
import { termLabel } from "@/lib/progress";
import AdminPanel from "./admin-panel";
import ResultsTab from "./results-tab";
import StudentView from "./student-view";

export default function DetailScreen({ assignmentId }: { assignmentId: number }) {
  const assignment = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api<AssignmentOut>(`/assignments/${assignmentId}`),
  });
  const status = useQuery({
    queryKey: ["grading", assignmentId],
    queryFn: () => api<GradingStatus>(`/assignments/${assignmentId}/grading`),
    refetchInterval: (q) => (q.state.data && !q.state.data.done ? 2000 : false),
  });
  const [tab, setTab] = useState<string | null>(null);

  if (assignment.error) {
    const e = assignment.error;
    return <p className="text-destructive">{e instanceof ApiError ? String(e.detail) : "불러오지 못했습니다"}</p>;
  }
  if (!assignment.data || !status.data) return <p className="text-muted-foreground">불러오는 중…</p>;
  const a = assignment.data;
  const graded = status.data.total > 0;
  const defaultTab = !graded ? "admin" : ["done", "finalized"].includes(a.progress.stage) ? "results" : "grade";

  return (
    <div className="flex flex-col gap-4">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          과목
        </Link>{" "}
        › {termLabel(a.course.term)} ›{" "}
        <Link href={`/courses/${a.course.id}`} className="hover:underline">
          {a.course.name} ({a.course.section}분반)
        </Link>
      </nav>
      <header className="flex items-start gap-4">
        <div className="flex flex-1 flex-col gap-1">
          {a.assessment && <p className="text-sm text-muted-foreground">{a.assessment}</p>}
          <h1 className="text-2xl font-bold">{a.title}</h1>
          <p className="text-muted-foreground whitespace-pre-wrap">{a.problem}</p>
        </div>
        {graded && (
          <Link href={`/assignments/${assignmentId}/review`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            항목별로 보기
          </Link>
        )}
      </header>

      {/* setup until graded, grading while cells are open, results once every cell is decided */}
      <Tabs value={tab ?? defaultTab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="grade" disabled={!graded}>
            채점
          </TabsTrigger>
          <TabsTrigger value="results" disabled={!graded}>
            결과
          </TabsTrigger>
          <TabsTrigger value="admin">관리</TabsTrigger>
        </TabsList>
        <TabsContent value="grade">{graded && <StudentView assignment={a} />}</TabsContent>
        <TabsContent value="results">{graded && <ResultsTab assignment={a} />}</TabsContent>
        <TabsContent value="admin">
          <AdminPanel assignment={a} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

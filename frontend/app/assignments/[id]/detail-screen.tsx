"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
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
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-bold">{a.title}</h1>
          {a.assessment && <span className="text-sm text-muted-foreground">{a.assessment}</span>}
        </div>
        {/* the question is what every answer is read against; the grading tab prints it on the exam paper */}
        {(tab ?? defaultTab) !== "grade" && (
          <section className="rounded-xl border-l-4 border-l-primary bg-card px-4 py-3 shadow-xs ring-1 ring-foreground/10">
            <p className="text-xs font-medium text-primary">문제</p>
            <p className="whitespace-pre-wrap text-[1.05rem] leading-7">{a.problem}</p>
          </section>
        )}
      </header>

      {/* setup until graded, grading while cells are open, results once every cell is decided */}
      <Tabs value={tab ?? defaultTab} onValueChange={(v) => setTab(String(v))}>
        <div className="flex items-center gap-2">
          <TabsList>
            <TabsTrigger value="admin">준비</TabsTrigger>
            <TabsTrigger value="grade" disabled={!graded}>
              채점
            </TabsTrigger>
            <TabsTrigger value="results" disabled={!graded}>
              결과
            </TabsTrigger>
          </TabsList>
          {graded && (
            <Link
              href={`/assignments/${assignmentId}/review`}
              className="ml-auto text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              항목별로 보기 →
            </Link>
          )}
        </div>
        <TabsContent value="grade">{graded && <StudentView assignment={a} onGoResults={() => setTab("results")} />}</TabsContent>
        <TabsContent value="results">{graded && <ResultsTab assignment={a} />}</TabsContent>
        <TabsContent value="admin">
          <AdminPanel assignment={a} onGradingStarted={() => setTab("grade")} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

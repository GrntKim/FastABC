"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError, type CourseSummary } from "@/lib/api";
import { STAGE_LABEL, termLabel } from "@/lib/progress";
import { useMe } from "@/lib/use-me";
import { GRADING_STEPS, StepList } from "@/components/step-list";
import CourseForm from "./course-form";

/** Home: the courses a grader manages, by term, then department. */
export default function CoursesHome() {
  const router = useRouter();
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => api<CourseSummary[]>("/courses") });
  const [term, setTerm] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (courses.error) {
    const e = courses.error;
    return <p className="text-destructive">{e instanceof ApiError ? String(e.detail) : "백엔드에 연결하지 못했습니다"}</p>;
  }
  if (!courses.data) return <p className="text-muted-foreground">불러오는 중…</p>;

  const terms = [...new Set(courses.data.map((c) => c.term))]; // already newest first
  const currentTerm = term ?? terms[0] ?? null;
  const inTerm = courses.data.filter((c) => c.term === currentTerm);
  const departments = [...new Set(inTerm.map((c) => c.department))];
  const shown = inTerm.filter((c) => !department || c.department === department);
  const attention = inTerm.reduce((sum, c) => sum + c.attention, 0);
  const courseForm = adding && (
    <CourseForm
      open={adding}
      onOpenChange={setAdding}
      defaults={{ term: currentTerm ?? undefined, department: department ?? departments[0] }}
      onSaved={(c) => router.push(`/courses/${c.id}`)}
    />
  );

  if (courses.data.length === 0)
    return (
      <>
        <Welcome onStart={() => setAdding(true)} />
        {courseForm}
      </>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold">과목</h1>
        {terms.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={t === currentTerm ? "secondary" : "ghost"}
            onClick={() => {
              setTerm(t);
              setDepartment(null);
            }}
          >
            {termLabel(t)}
          </Button>
        ))}
        <Button className="ml-auto" onClick={() => setAdding(true)}>
          과목 추가
        </Button>
      </div>

      {attention > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          이번 학기에 확인할 곳이 남은 과목이 <strong>{inTerm.filter((c) => c.attention > 0).length}개</strong> 있습니다. 표시된 과목부터 이어서 채점하세요.
        </p>
      )}

      {departments.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant={department ? "ghost" : "secondary"} onClick={() => setDepartment(null)}>
            전체 학과
          </Button>
          {departments.map((d) => (
            <Button key={d} size="xs" variant={department === d ? "secondary" : "ghost"} onClick={() => setDepartment(d)}>
              {d}
            </Button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => (
          <Link key={c.id} href={`/courses/${c.id}`} className="group">
            <Card className="h-full transition-colors group-hover:bg-muted/40">
              <CardHeader>
                <p className="text-xs text-muted-foreground">{c.department}</p>
                <CardTitle className="text-lg">
                  {c.name} <span className="text-muted-foreground font-normal">· {c.section}분반</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <p className="text-muted-foreground">
                  문항 {c.assignment_count} · 답안 {c.submission_count}
                </p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(c.stages).map(([stage, count]) => (
                    <Badge key={stage} variant="outline">
                      {STAGE_LABEL[stage] ?? stage} {count}
                    </Badge>
                  ))}
                  {c.attention > 0 && <Badge>확인할 곳 있음</Badge>}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {courseForm}
    </div>
  );
}

/** First visit: what the app does in three steps, and the one thing to do now. */
function Welcome({ onStart }: { onStart: () => void }) {
  const me = useMe();
  return (
    <Card className="mx-auto mt-6 w-full max-w-3xl">
      <CardHeader>
        <CardTitle className="text-2xl">{me.data ? `${me.data.name}님, 반갑습니다` : "반갑습니다"}</CardTitle>
        <CardDescription className="text-base">
          AI가 먼저 모든 답안을 읽고, 채점자가 봐야 할 곳만 골라 드립니다. 점수는 언제나 채점자가 확정합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <StepList steps={GRADING_STEPS} />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={onStart}>
            첫 과목 추가
          </Button>
          <span className="text-sm text-muted-foreground">과목(학과·학기·분반)을 만들면 그 안에 문항을 추가합니다.</span>
        </div>
        <p className="border-t pt-3 text-xs text-muted-foreground">
          학생 이름은 저장하지 않고, 채점하는 동안에는 학번 대신 S001 같은 라벨만 보입니다.
        </p>
      </CardContent>
    </Card>
  );
}

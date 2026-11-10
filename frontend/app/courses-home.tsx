"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError, type CourseGroup, type CourseSummary } from "@/lib/api";
import { STAGE_LABEL, termLabel } from "@/lib/progress";
import { useMe } from "@/lib/use-me";
import { cn } from "@/lib/utils";
import { GradesDue } from "@/components/grades-due";
import { GRADING_STEPS, StepList } from "@/components/step-list";
import CourseForm from "./course-form";

/** Home: the courses a grader manages, by term, then department. */
export default function CoursesHome() {
  const router = useRouter();
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => api<CourseSummary[]>("/courses") });
  const [term, setTerm] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
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
  // midterm and final always: picking one with nothing in it says so; "the rest" only when there is some
  const periods = PERIODS.filter((p) => p.value !== "other" || inTerm.some((c) => c.groups.some((g) => g.period === "other")));
  // the exam period picks which exams each card shows; courses without one drop out
  const groupsOf = (c: CourseSummary) => c.groups.filter((g) => !period || g.period === period);
  const shown = inTerm.filter((c) => (!department || c.department === department) && (!period || groupsOf(c).length > 0));
  const attentionCourses = shown.filter((c) => groupsOf(c).some((g) => g.attention > 0)).length;
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
              setPeriod(null);
            }}
          >
            {termLabel(t)}
          </Button>
        ))}
        {currentTerm && <GradesDue key={currentTerm} term={currentTerm} className="ml-2" />}
        <Button className="ml-auto" onClick={() => setAdding(true)}>
          과목 추가
        </Button>
      </div>

      {attentionCourses > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          {period ? `${PERIOD_LABEL[period]} 시험에` : "이번 학기에"} 확인할 곳이 남은 과목이 <strong>{attentionCourses}개</strong> 있습니다. 표시된 과목부터
          이어서 채점하세요.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <Button size="xs" variant={period ? "ghost" : "secondary"} onClick={() => setPeriod(null)}>
          전체 시험
        </Button>
        {periods.map((p) => (
          <Button key={p.value} size="xs" variant={period === p.value ? "secondary" : "ghost"} onClick={() => setPeriod(p.value)}>
            {p.name}
          </Button>
        ))}
        {departments.length > 1 && <span className="mx-2 h-4 w-px bg-border" aria-hidden />}
        {departments.length > 1 && (
          <>
            <Button size="xs" variant={department ? "ghost" : "secondary"} onClick={() => setDepartment(null)}>
              전체 학과
            </Button>
            {departments.map((d) => (
              <Button key={d} size="xs" variant={department === d ? "secondary" : "ghost"} onClick={() => setDepartment(d)}>
                {d}
              </Button>
            ))}
          </>
        )}
      </div>

      {shown.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {period ? `이 학기에 ${PERIOD_LABEL[period]} 시험이 있는 과목이 없습니다. 과목 화면에서 시험을 추가하세요.` : "표시할 과목이 없습니다."}
        </p>
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
                <ul className="flex flex-col gap-1.5">
                  {groupsOf(c).map((g) => (
                    <GroupRow key={g.exam_id ?? "none"} group={g} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {courseForm}
    </div>
  );
}

type Period = CourseGroup["period"];

const PERIODS: { value: Period; name: string }[] = [
  { value: "midterm", name: "중간" },
  { value: "final", name: "기말" },
  { value: "other", name: "그 외 (퀴즈·과제 등)" },
];
const PERIOD_LABEL: Record<Period, string> = { midterm: "중간", final: "기말", other: "그 외" };
// the period as a tag on each card row, the same colors as nothing else on the page uses
const PERIOD_TAG: Record<Period, string> = {
  midterm: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  final: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  other: "bg-muted text-muted-foreground",
};

/** One exam of a course card: its name, where its questions stand, and whether anything needs a look. */
function GroupRow({ group: g }: { group: CourseGroup }) {
  const stages = Object.keys(STAGE_LABEL).filter((s) => g.stages[s]);
  return (
    <li className="flex flex-wrap items-center gap-1">
      <span className={cn("w-9 shrink-0 rounded px-1 py-0.5 text-center text-[0.7rem] font-medium", PERIOD_TAG[g.period])}>
        {PERIOD_LABEL[g.period]}
      </span>
      <span className="mr-1 text-xs font-medium">{g.name ?? "시험 밖 문항"}</span>
      {g.assignment_count === 0 ? (
        <span className="text-xs text-muted-foreground">문항 없음</span>
      ) : (
        stages.map((s) => (
          <Badge key={s} variant="outline">
            {STAGE_LABEL[s]} {g.stages[s]}
          </Badge>
        ))
      )}
      {g.attention > 0 && <Badge>확인할 곳 있음</Badge>}
    </li>
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
          AI에는 학생 이름·학번을 지운 답안만 보냅니다. 원하면 이름을 가리고 채점할 수도 있습니다.
        </p>
      </CardContent>
    </Card>
  );
}

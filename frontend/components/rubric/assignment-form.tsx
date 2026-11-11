"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  ApiError,
  json,
  type AssignmentOut,
  type CourseOut,
  type RubricDraftOut,
  type RubricItemIn,
} from "@/lib/api";
import { termLabel } from "@/lib/progress";
import ItemEditor from "./item-editor";

export type AssignmentDraft = { examId: number | null; number: number | null; title: string; problem: string; items: RubricItemIn[] };

const GATE_ITEM: RubricItemIn = {
  key: "is_on_topic",
  label: "주제 관련성",
  type: "noul",
  kind: "gate",
  instructions: "`answer`가 `question`의 주제를 다루려고 시도한다.",
  criteria: null,
};

const NEW_ITEM: Record<string, RubricItemIn> = {
  credit: { key: "", label: "", type: "noul", kind: "credit", instructions: "`answer`이 ", points: 1, criteria: null },
  score: {
    key: "",
    label: "",
    type: "score",
    kind: "credit",
    instructions: "`answer`의 ",
    criteria: ["", "", ""],
    points_map: { "0": 0, "1": 1, "2": 2 },
  },
  deduction: { key: "", label: "", type: "noul", kind: "deduction", instructions: "`answer`이 ", points: 1, criteria: null },
};

/** The topic check is not the grader's to write: it is always there, first. */
const withGate = (items: RubricItemIn[]) => (items.some((i) => i.kind === "gate") ? items : [GATE_ITEM, ...items]);

/** Graders name items by label; a missing key (the judge question id) is generated. */
function withKeys(items: RubricItemIn[]): RubricItemIn[] {
  const taken = new Set(items.map((i) => i.key.trim()).filter(Boolean));
  return items.map((item, i) => {
    let key = item.key.trim();
    for (let n = i + 1; !key || (key !== item.key.trim() && taken.has(key)); n++) key = `item_${n}`;
    taken.add(key);
    return { ...item, key, label: item.label?.trim() || null };
  });
}

type ValidationDetail = { loc: (string | number)[]; msg: string }[];

/**
 * Problem and rubric of a question: plain-language rubric -> LLM draft -> grader edits -> save.
 * Creates a new question, or replaces one that has not been graded yet when `assignmentId` is given.
 */
export default function AssignmentForm({
  courseId,
  assignmentId,
  examId: startExam = null,
  initial,
}: {
  courseId: number;
  assignmentId?: number;
  examId?: number | null; // a new question started from an exam
  initial?: AssignmentDraft;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const course = useQuery({ queryKey: ["course", courseId], queryFn: () => api<CourseOut>(`/courses/${courseId}`) });

  const [examId, setExamId] = useState<number | null>(initial ? initial.examId : startExam);
  const [number, setNumber] = useState(initial?.number != null ? String(initial.number) : "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [problem, setProblem] = useState(initial?.problem ?? "");
  const [rubricText, setRubricText] = useState("");
  const [items, setItems] = useState<RubricItemIn[] | null>(initial?.items ?? null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [itemProblems, setItemProblems] = useState<Record<number, string[]>>({});
  const [formProblems, setFormProblems] = useState<string[]>([]);
  const [jsonText, setJsonText] = useState<string | null>(null);

  const draft = useMutation({
    mutationFn: () => api<RubricDraftOut>("/rubric-drafts", json({ problem, rubric_text: rubricText })),
    onSuccess: (d) => {
      setItems(d.items as RubricItemIn[]);
      setWarnings([...d.warnings, ...d.problems]);
      setItemProblems({});
    },
    onError: (e) => toast.error(e instanceof ApiError ? String(e.detail) : "변환하지 못했습니다"),
  });

  const save = useMutation({
    mutationFn: () =>
      api<AssignmentOut>(
        assignmentId ? `/assignments/${assignmentId}` : "/assignments",
        json(
          {
            course_id: courseId,
            exam_id: examId,
            number: examId === null ? null : Number(number) || nextNumber,
            title,
            problem,
            items: withKeys(withGate(items ?? [])),
          },
          assignmentId ? "PUT" : "POST",
        ),
      ),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ["course", courseId] });
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      queryClient.setQueryData(["assignment", a.id], a);
      toast.success(assignmentId ? "문항을 수정했습니다." : "문항을 만들었습니다. 답안은 시험 결과에서 올립니다.");
      router.push(`/assignments/${a.id}`);
    },
    onError: (e) => {
      if (!(e instanceof ApiError) || !Array.isArray(e.detail)) {
        toast.error(e instanceof ApiError ? String(e.detail) : "저장하지 못했습니다");
        return;
      }
      // pydantic errors: ["body", "items", 3, ...] belong to item 3, everything else to the form
      const byItem: Record<number, string[]> = {};
      const rest: string[] = [];
      for (const { loc, msg } of e.detail as ValidationDetail) {
        const i = loc[1] === "items" && typeof loc[2] === "number" ? loc[2] : null;
        if (i === null) rest.push(`${loc.slice(1).join(".") || "입력"}: ${msg}`);
        else (byItem[i] ??= []).push(msg);
      }
      setItemProblems(byItem);
      setFormProblems(rest);
      toast.error("고칠 부분이 있습니다");
    },
  });

  const maxPoints = (items ?? []).reduce((sum, i) => {
    if (i.kind !== "credit") return sum;
    return sum + (i.type === "noul" ? (i.points ?? 0) : Math.max(0, ...Object.values(i.points_map ?? {})));
  }, 0);
  const scored = (items ?? []).filter((i) => i.kind !== "gate").length;
  // the next free number in the chosen exam, used when the grader leaves it empty
  const nextNumber =
    Math.max(0, ...(course.data?.assignments ?? []).filter((a) => a.exam_id === examId && a.id !== assignmentId).map((a) => a.number ?? 0)) + 1;
  const ready = title.trim() && problem.trim() && scored >= 1 && (examId !== null || !!assignmentId);

  return (
    <div className="flex flex-col gap-5">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          과목
        </Link>
        {course.data && (
          <>
            {" "}
            › {termLabel(course.data.term)} ›{" "}
            <Link href={`/courses/${courseId}`} className="hover:underline">
              {course.data.name} ({course.data.section}분반)
            </Link>
          </>
        )}{" "}
        › {assignmentId ? "문항 수정" : "새 문항"}
      </nav>
      <h1 className="text-2xl font-bold">{assignmentId ? "문항 수정" : "새 문항"}</h1>

      <Card>
        <CardHeader>
          <CardTitle>1. 문제</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[10rem_5rem_1fr]">
            {assignmentId || startExam === null ? (
              <select
                className="h-9 rounded-md border bg-card px-2 text-sm"
                aria-label="시험"
                value={examId ?? ""}
                onChange={(e) => setExamId(e.target.value ? Number(e.target.value) : null)}
              >
                {/* every new question lives in an exam; only an old one outside them keeps the choice */}
                {(examId === null || !course.data?.exams.length) && <option value="">{assignmentId ? "시험 없음" : "시험을 고르세요"}</option>}
                {course.data?.exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.name}
                  </option>
                ))}
              </select>
            ) : (
              // a new question belongs to the exam it was started from ("+ 문항 추가"), nothing to choose
              <p className="flex h-9 items-center rounded-md bg-muted px-3 text-sm" aria-label="시험">
                {examId === null ? "시험 없음" : (course.data?.exams.find((e) => e.id === examId)?.name ?? "…")}
              </p>
            )}
            <Input
              type="number"
              min={1}
              max={99}
              aria-label="문항 번호"
              disabled={examId === null}
              placeholder={examId === null ? "번호" : `${nextNumber}번`}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
            <Input placeholder="문항 제목 (예: 교착상태 필요조건)" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {course.data && course.data.exams.length === 0 && (
            <p className="text-xs text-muted-foreground">
              문항은 시험 안에 만듭니다. 과목 화면에서 시험(중간고사·퀴즈·과제)을 먼저 추가하세요.
            </p>
          )}
          <Textarea rows={3} placeholder="학생에게 낸 문제 그대로" value={problem} onChange={(e) => setProblem(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. 채점 기준</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            평소 쓰는 채점 기준을 그대로 적으세요. AI가 항목별로 나눠 드리고, 아래에서 고친 뒤 저장합니다.
            {initial && " 지금 항목을 그대로 고치려면 이 칸은 비워 두세요. 다시 나누면 아래 항목이 바뀝니다."}
          </p>
          <Textarea
            rows={4}
            placeholder="예: 네 가지 필요조건 모두 언급 4점(하나당 1점), 예방 방법 제시 2점, 설명의 논리성 0~3점. 교착상태와 기아를 혼동하면 1점 감점"
            value={rubricText}
            onChange={(e) => setRubricText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!problem.trim() || !rubricText.trim() || draft.isPending} onClick={() => draft.mutate()}>
              {draft.isPending ? "나누는 중…" : items ? "다시 나누기" : "항목으로 나누기"}
            </Button>
            {!items && (
              <Button variant="ghost" onClick={() => setItems([GATE_ITEM, { ...NEW_ITEM.credit }])}>
                직접 작성
              </Button>
            )}
          </div>
          {draft.isPending && <DraftProgress />}
        </CardContent>
      </Card>

      {items && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <CardTitle>3. 채점 항목 확인</CardTitle>
            <span className="ml-auto text-sm text-muted-foreground">만점 {maxPoints}점</span>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {warnings.map((w) => (
              <p key={w} className="text-sm text-amber-700 dark:text-amber-400">
                {w}
              </p>
            ))}
            {items.map((item, i) =>
              item.kind === "gate" ? null : (
                <ItemEditor
                  key={i}
                  index={items.slice(0, i).filter((it) => it.kind !== "gate").length}
                  item={item}
                  problems={itemProblems[i] ?? []}
                  onChange={(next) => setItems(items.map((it, j) => (j === i ? next : it)))}
                  onRemove={() => setItems(items.filter((_, j) => j !== i))}
                />
              ),
            )}
            <p className="text-xs text-muted-foreground">
              빈 답안이나 문제와 관련 없는 답안은 AI가 알아보고 모든 항목에 0점을 추천합니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setItems([...items, { ...NEW_ITEM.credit }])}>
                + 충족 여부 항목
              </Button>
              <Button size="sm" variant="outline" onClick={() => setItems([...items, { ...NEW_ITEM.score }])}>
                + 수준별 항목
              </Button>
              <Button size="sm" variant="outline" onClick={() => setItems([...items, { ...NEW_ITEM.deduction }])}>
                + 감점 항목
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => setJsonText(jsonText === null ? JSON.stringify(items, null, 2) : null)}
              >
                {jsonText === null ? "고급: JSON으로 편집" : "JSON 닫기"}
              </Button>
            </div>
            {jsonText !== null && (
              <div className="flex flex-col gap-2">
                <Textarea rows={12} className="font-mono text-xs" value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(jsonText);
                      if (!Array.isArray(parsed)) throw new Error("not an array");
                      setItems(parsed);
                      setJsonText(null);
                    } catch {
                      toast.error("JSON 배열 형식이 아닙니다");
                    }
                  }}
                >
                  JSON 적용
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {formProblems.map((p) => (
        <p key={p} className="text-sm text-destructive">
          {p}
        </p>
      ))}
      <div className="flex justify-end gap-2">
        <Link
          href={assignmentId ? `/assignments/${assignmentId}` : `/courses/${courseId}`}
          className="text-sm text-muted-foreground hover:underline self-center"
        >
          취소
        </Link>
        <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          {assignmentId ? "수정 저장" : "문항 저장"}
        </Button>
      </div>
    </div>
  );
}

/** The 10–20 s wait for the AI draft as a bar that fills toward the usual time and holds short of the end. */
function DraftProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - start) / 1000), 250);
    return () => clearInterval(timer);
  }, []);
  const value = 95 * (1 - Math.exp(-elapsed / 8));
  return (
    <div className="flex flex-col gap-1.5" role="status">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear" style={{ width: `${value}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">AI가 채점 기준을 항목으로 나누는 중 · {Math.floor(elapsed)}초 (보통 10~20초)</p>
    </div>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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

const GATE_ITEM: RubricItemIn = {
  key: "is_on_topic",
  label: "주제 관련성",
  type: "noul",
  kind: "gate",
  instructions: "`answer`가 `question`의 주제를 다루려고 시도한다.",
  criteria: null,
};

const NEW_ITEM: Record<string, RubricItemIn> = {
  credit: { key: "", label: "", type: "noul", kind: "credit", instructions: "`answer`가 ", points: 1, criteria: null },
  score: {
    key: "",
    label: "",
    type: "score",
    kind: "credit",
    instructions: "`answer`의 ",
    criteria: ["", "", ""],
    points_map: { "0": 0, "1": 1, "2": 2 },
  },
  deduction: { key: "", label: "오개념: ", type: "noul", kind: "deduction", instructions: "`answer`가 ", points: 1, criteria: null },
};

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

/** Problem and rubric for a new question: plain-language rubric -> LLM draft -> grader edits -> save. */
export default function NewAssignment({ courseId }: { courseId: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const course = useQuery({ queryKey: ["course", courseId], queryFn: () => api<CourseOut>(`/courses/${courseId}`) });

  const [assessment, setAssessment] = useState("");
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [rubricText, setRubricText] = useState("");
  const [items, setItems] = useState<RubricItemIn[] | null>(null);
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
        "/assignments",
        json({ course_id: courseId, assessment: assessment || null, title, problem, items: withKeys(items ?? []) }),
      ),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ["course", courseId] });
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      toast.success("문항을 만들었습니다. 답안을 올리세요.");
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
  const ready = title.trim() && problem.trim() && items && items.length >= 2;

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
        › 새 문항
      </nav>
      <h1 className="text-2xl font-bold">새 문항</h1>

      <Card>
        <CardHeader>
          <CardTitle>1. 문제</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <Input placeholder="평가명 (예: 중간고사 2번)" value={assessment} onChange={(e) => setAssessment(e.target.value)} />
            <Input placeholder="문항 제목 (예: 교착상태 필요조건)" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <Textarea rows={3} placeholder="학생에게 낸 문제 그대로" value={problem} onChange={(e) => setProblem(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. 채점 기준</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            평소 쓰는 채점 기준을 그대로 적으세요. 판단 질문으로 바꿔 드리고, 아래에서 고친 뒤 저장합니다.
          </p>
          <Textarea
            rows={4}
            placeholder="예: 네 가지 필요조건 모두 언급 4점(하나당 1점), 예방 방법 제시 2점, 설명의 논리성 0~3점. 교착상태와 기아를 혼동하면 1점 감점"
            value={rubricText}
            onChange={(e) => setRubricText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!problem.trim() || !rubricText.trim() || draft.isPending} onClick={() => draft.mutate()}>
              {draft.isPending ? "판단 질문 만드는 중… (10~20초)" : items ? "다시 만들기" : "판단 질문 만들기"}
            </Button>
            {!items && (
              <Button variant="ghost" onClick={() => setItems([GATE_ITEM, { ...NEW_ITEM.credit }])}>
                직접 작성
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {items && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <CardTitle>3. 판단 질문 확인</CardTitle>
            <span className="ml-auto text-sm text-muted-foreground">만점 {maxPoints}점</span>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {warnings.map((w) => (
              <p key={w} className="text-sm text-amber-700 dark:text-amber-400">
                {w}
              </p>
            ))}
            {items.map((item, i) => (
              <ItemEditor
                key={i}
                index={i}
                item={item}
                problems={itemProblems[i] ?? []}
                onChange={(next) => setItems(items.map((it, j) => (j === i ? next : it)))}
                onRemove={item.kind === "gate" ? undefined : () => setItems(items.filter((_, j) => j !== i))}
              />
            ))}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setItems([...items, { ...NEW_ITEM.credit }])}>
                + 예/아니오 항목
              </Button>
              <Button size="sm" variant="outline" onClick={() => setItems([...items, { ...NEW_ITEM.score }])}>
                + 수준 항목
              </Button>
              <Button size="sm" variant="outline" onClick={() => setItems([...items, { ...NEW_ITEM.deduction }])}>
                + 오개념(감점) 항목
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => setJsonText(jsonText === null ? JSON.stringify(items, null, 2) : null)}
              >
                {jsonText === null ? "JSON으로 편집" : "JSON 닫기"}
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
        <Link href={`/courses/${courseId}`} className="text-sm text-muted-foreground hover:underline self-center">
          취소
        </Link>
        <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          문항 저장
        </Button>
      </div>
    </div>
  );
}

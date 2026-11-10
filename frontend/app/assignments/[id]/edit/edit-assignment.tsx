"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import AssignmentForm from "@/components/rubric/assignment-form";
import { api, ApiError, type AssignmentOut } from "@/lib/api";

/** Rubric edits are allowed only before grading: judgments already made would no longer match the questions. */
export default function EditAssignment({ assignmentId }: { assignmentId: number }) {
  const assignment = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api<AssignmentOut>(`/assignments/${assignmentId}`),
  });
  if (assignment.error) {
    const e = assignment.error;
    return <p className="text-destructive">{e instanceof ApiError ? String(e.detail) : "불러오지 못했습니다"}</p>;
  }
  if (!assignment.data) return <p className="text-muted-foreground">불러오는 중…</p>;
  const a = assignment.data;

  if (a.progress.cells > 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">문항 수정</h1>
        <p>
          이미 채점한 문항은 채점 기준을 바꿀 수 없습니다. 지금 판단과 추천이 바뀐 기준과 맞지 않게 되기 때문입니다.
        </p>
        <Link href={`/assignments/${assignmentId}`} className="underline">
          문항으로 돌아가기
        </Link>
      </div>
    );
  }
  return (
    <AssignmentForm
      courseId={a.course_id}
      assignmentId={a.id}
      initial={{
        examId: a.exam_id,
        number: a.number,
        title: a.title,
        problem: a.problem,
        items: a.items.map((i) => ({
          key: i.key,
          label: i.label,
          type: i.type,
          kind: i.kind,
          instructions: i.instructions,
          criteria: i.criteria,
          points: i.points,
          points_map: i.points_map,
        })),
      }}
    />
  );
}

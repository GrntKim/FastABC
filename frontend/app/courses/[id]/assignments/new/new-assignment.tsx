"use client";

import { useSearchParams } from "next/navigation";
import AssignmentForm from "@/components/rubric/assignment-form";

/** `?exam=3` starts the question inside that exam (from "이 시험에 문항 추가"). */
export default function NewAssignment({ courseId }: { courseId: number }) {
  const exam = Number(useSearchParams().get("exam")) || null;
  return <AssignmentForm courseId={courseId} examId={exam} />;
}

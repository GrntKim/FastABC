"use client";

import { useRouter, useSearchParams } from "next/navigation";
import AssignmentForm from "@/components/rubric/assignment-form";

/**
 * `?exam=3` starts the question inside that exam (from "+ 문항 추가" of the exam). Each visit starts empty:
 * the page stays mounted between visits, so the last question's text would otherwise still be there.
 * Keyed on bfcacheId, which changes on a fresh visit but not on back/forward, so going back keeps a draft.
 */
export default function NewAssignment({ courseId }: { courseId: number }) {
  const exam = Number(useSearchParams().get("exam")) || null;
  const { bfcacheId } = useRouter();
  return <AssignmentForm key={`${bfcacheId}-${exam}`} courseId={courseId} examId={exam} />;
}

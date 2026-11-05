"use client";

import AssignmentForm from "@/components/rubric/assignment-form";

export default function NewAssignment({ courseId }: { courseId: number }) {
  return <AssignmentForm courseId={courseId} />;
}

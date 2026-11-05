"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError, json, type CourseIn, type CourseOut } from "@/lib/api";

const FIELDS: { key: keyof CourseIn; label: string; placeholder: string }[] = [
  { key: "department", label: "학과", placeholder: "컴퓨터공학과" },
  { key: "term", label: "학기", placeholder: "2026-2" },
  { key: "name", label: "과목", placeholder: "딥러닝개론" },
  { key: "section", label: "분반", placeholder: "01" },
];

/** Create a course, or edit one when `course` is given. */
export default function CourseForm({
  open,
  onOpenChange,
  course,
  defaults,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course?: CourseOut;
  defaults?: Partial<CourseIn>;
  onSaved?: (course: CourseOut) => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<CourseIn>({
    department: course?.department ?? defaults?.department ?? "",
    term: course?.term ?? defaults?.term ?? "",
    name: course?.name ?? "",
    section: course?.section ?? "",
  });
  const save = useMutation({
    mutationFn: () =>
      course ? api<CourseOut>(`/courses/${course.id}`, json(values, "PUT")) : api<CourseOut>("/courses", json(values)),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      queryClient.setQueryData(["course", saved.id], saved);
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError && e.status === 409 ? "같은 학과·학기·과목·분반이 이미 있습니다" : "저장하지 못했습니다"),
  });
  const valid = FIELDS.every((f) => values[f.key].trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{course ? "과목 수정" : "과목 추가"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-sm">
              {f.label}
              <Input
                value={values[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            </label>
          ))}
          <DialogFooter className="col-span-2">
            <Button type="submit" disabled={!valid || save.isPending}>
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

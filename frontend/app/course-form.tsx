"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError, json, type CourseIn, type CourseOut } from "@/lib/api";
import { currentTerm, TERM_SESSIONS } from "@/lib/progress";

const FIELDS: { key: Exclude<keyof CourseIn, "term">; label: string; placeholder: string }[] = [
  { key: "department", label: "학과", placeholder: "컴퓨터공학과" },
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
    term: course?.term ?? defaults?.term ?? currentTerm(),
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
  const [year, session] = values.term.split("-");
  const setTerm = (y: string, s: string) => setValues({ ...values, term: `${y}-${s}` });
  const valid = FIELDS.every((f) => values[f.key].trim()) && /^\d{4}$/.test(year ?? "");

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
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            학기
            <span className="grid grid-cols-[6rem_1fr] gap-2">
              <Input
                type="number"
                min={2000}
                max={2100}
                aria-label="연도"
                value={year ?? ""}
                onChange={(e) => setTerm(e.target.value, session ?? "1")}
              />
              <select
                className="h-9 rounded-md border bg-card px-2 text-sm"
                aria-label="학기 구분"
                value={session ?? "1"}
                onChange={(e) => setTerm(year ?? "", e.target.value)}
              >
                {TERM_SESSIONS.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
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

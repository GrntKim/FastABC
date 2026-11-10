"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError, json, type ExamRef } from "@/lib/api";

// the usual ones a click away; anything else is typed
const EXAM_NAMES = ["중간고사", "기말고사", "퀴즈", "과제"];

/** Add an exam to a course, or rename one when `exam` is given. */
export default function ExamForm({
  courseId,
  exam,
  onClose,
}: {
  courseId: number;
  exam?: ExamRef;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(exam?.name ?? "");
  const save = useMutation({
    mutationFn: () =>
      exam ? api<ExamRef>(`/exams/${exam.id}`, json({ name }, "PATCH")) : api<ExamRef>(`/courses/${courseId}/exams`, json({ name })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course", courseId] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.status === 409 ? String(e.detail) : "저장하지 못했습니다"),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{exam ? "시험 이름 바꾸기" : "시험 추가"}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            시험 이름
            <span className="flex flex-wrap gap-1">
              {EXAM_NAMES.map((n) => (
                <Button key={n} type="button" size="xs" variant={name === n ? "secondary" : "outline"} onClick={() => setName(n)}>
                  {n}
                </Button>
              ))}
            </span>
            <Input autoFocus value={name} placeholder="중간고사" onChange={(e) => setName(e.target.value)} />
            <span className="text-xs text-muted-foreground">문항은 시험마다 따로 채점하고, 시험 결과에서 학생별로 합산합니다.</span>
          </label>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || save.isPending}>
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

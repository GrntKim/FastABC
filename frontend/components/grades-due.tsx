"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, json, type TermScheduleOut } from "@/lib/api";
import { termLabel } from "@/lib/progress";
import { cn } from "@/lib/utils";

/** The term's grade due date from the grader's academic calendar, if they set one. */
export function useGradesDue(term: string) {
  return useQuery({
    queryKey: ["term", term],
    queryFn: () => api<TermScheduleOut>(`/terms/${term}`),
  });
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Days left until the due date (0 on the day itself, negative once past) and how to say it. */
export function dueStatus(due: string) {
  const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD in local time
  const days = dayNumber(due) - dayNumber(today);
  const [, m, d] = due.split("-").map(Number);
  return {
    date: `${m}월 ${d}일`,
    days,
    past: days < 0,
    left: days < 0 ? "마감 지남" : days === 0 ? "오늘 마감" : `${days}일 남음`,
    tone: days < 0 ? "text-destructive" : days <= 7 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
  };
}

/** One line for the term's due date, with a way to set or change it. */
export function GradesDue({ term, className }: { term: string; className?: string }) {
  const due = useGradesDue(term);
  const [editing, setEditing] = useState(false);
  if (!due.data) return null;
  const status = due.data.grades_due ? dueStatus(due.data.grades_due) : null;
  return (
    <>
      {status ? (
        <button
          type="button"
          className={cn("text-sm hover:underline", status.tone, className)}
          title="학사일정의 성적 입력 마감일 · 눌러서 바꾸기"
          onClick={() => setEditing(true)}
        >
          성적 입력 마감 {status.date} · {status.left}
        </button>
      ) : (
        <Button size="xs" variant="ghost" className={cn("text-muted-foreground", className)} onClick={() => setEditing(true)}>
          성적 입력 마감일 넣기
        </Button>
      )}
      {editing && <DueDialog term={term} current={due.data.grades_due} onClose={() => setEditing(false)} />}
    </>
  );
}

function DueDialog({ term, current, onClose }: { term: string; current: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(current ?? "");
  const save = useMutation({
    mutationFn: (grades_due: string | null) => api<TermScheduleOut>(`/terms/${term}`, json({ grades_due }, "PUT")),
    onSuccess: (r) => {
      queryClient.setQueryData(["term", term], r);
      toast.success(r.grades_due ? "마감일을 저장했습니다" : "마감일을 지웠습니다");
      onClose();
    },
    onError: () => toast.error("저장하지 못했습니다"),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{termLabel(term)} 성적 입력 마감일</DialogTitle>
          <DialogDescription>
            학사일정의 마감일을 넣으면 성적 확정 화면에 남은 날짜가 나오고, 마감이 지난 뒤 확정할 때 한 번 더 묻습니다.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (value) save.mutate(value);
          }}
        >
          <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
          <DialogFooter>
            {current && (
              <Button type="button" variant="ghost" className="mr-auto" disabled={save.isPending} onClick={() => save.mutate(null)}>
                지우기
              </Button>
            )}
            <Button type="submit" disabled={!value || save.isPending}>
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

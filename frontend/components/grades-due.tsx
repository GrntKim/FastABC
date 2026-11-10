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

/** The term's grade due dates from the grader's academic calendar, if they set them. */
export function useGradesDue(term: string) {
  return useQuery({
    queryKey: ["term", term],
    queryFn: () => api<TermScheduleOut>(`/terms/${term}`),
  });
}

/** 중간고사, 중간시험…: the same rule as the backend's `is_midterm`. */
const isMidterm = (examName: string | null) => examName?.includes("중간") ?? false;

/**
 * The due date a question's grades fall under: the midterm one for a midterm question when it is set,
 * otherwise the final one (기말고사, quizzes, questions outside an exam).
 */
export function dueFor(schedule: TermScheduleOut | undefined, examName: string | null) {
  if (!schedule) return null;
  const midterm = isMidterm(examName);
  if (midterm && schedule.midterm_due) return { label: "중간고사", date: schedule.midterm_due, fallback: false };
  // a midterm question with no midterm date falls back to the final one: say so
  return schedule.final_due ? { label: "기말", date: schedule.final_due, fallback: midterm } : null;
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

/**
 * The term's due dates, with a way to set or change them. Given a question's exam, only the date that
 * question falls under; otherwise both midterm and final.
 */
export function GradesDue({
  term,
  question,
  className,
}: {
  term: string;
  question?: { examName: string | null };
  className?: string;
}) {
  const schedule = useGradesDue(term);
  const [editing, setEditing] = useState(false);
  if (!schedule.data) return null;
  const s = schedule.data;

  const own = question ? dueFor(s, question.examName) : null;
  const any = question ? own !== null : Boolean(s.midterm_due || s.final_due);

  return (
    <>
      {!any ? (
        <Button size="xs" variant="ghost" className={cn("text-muted-foreground", className)} onClick={() => setEditing(true)}>
          성적 입력 마감일 넣기
        </Button>
      ) : (
        <button
          type="button"
          className={cn("flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground hover:underline", className)}
          title="학사일정의 성적 입력 마감일 · 눌러서 바꾸기"
          onClick={() => setEditing(true)}
        >
          {question && own ? (
            // a question: only the date it falls under
            <>
              {own.label} 성적 입력 마감 <Due date={own.date} />
              {own.fallback && <span>· 중간 마감 미정</span>}
            </>
          ) : (
            // the term: both dates side by side, an unset one said so
            <>
              성적 입력 마감
              {[
                { label: "중간", date: s.midterm_due },
                { label: "기말", date: s.final_due },
              ].map((d) => (
                <span key={d.label} className="rounded-md border px-1.5 py-0.5">
                  <span className="font-medium text-foreground/80">{d.label}</span>{" "}
                  {d.date ? <Due date={d.date} /> : <span>미정</span>}
                </span>
              ))}
            </>
          )}
        </button>
      )}
      {editing && <DueDialog schedule={s} onClose={() => setEditing(false)} />}
    </>
  );
}

function Due({ date }: { date: string }) {
  const status = dueStatus(date);
  return (
    <span className={status.tone}>
      {status.date} ({status.left})
    </span>
  );
}

function DueDialog({ schedule, onClose }: { schedule: TermScheduleOut; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { term } = schedule;
  const [midterm, setMidterm] = useState(schedule.midterm_due ?? "");
  const [final, setFinal] = useState(schedule.final_due ?? "");
  const save = useMutation({
    mutationFn: (body: { midterm_due: string | null; final_due: string | null }) =>
      api<TermScheduleOut>(`/terms/${term}`, json(body, "PUT")),
    onSuccess: (r) => {
      queryClient.setQueryData(["term", term], r);
      toast.success(r.midterm_due || r.final_due ? "마감일을 저장했습니다" : "마감일을 지웠습니다");
      onClose();
    },
    onError: () => toast.error("저장하지 못했습니다"),
  });
  const fields = [
    { label: "중간고사 성적 입력 마감", value: midterm, set: setMidterm, hint: "이름에 '중간'이 들어간 시험의 문항" },
    { label: "기말(학기말) 성적 입력 마감", value: final, set: setFinal, hint: "기말고사·퀴즈·과제, 시험에 묶이지 않은 문항" },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{termLabel(term)} 성적 입력 마감일</DialogTitle>
          <DialogDescription>
            학사일정의 마감일을 넣으면 성적 확정 화면에 남은 날짜가 나오고, 마감이 지난 뒤 확정할 때 한 번 더 묻습니다. 중간
            마감을 비워 두면 중간고사도 기말 마감을 따릅니다.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ midterm_due: midterm || null, final_due: final || null });
          }}
        >
          {fields.map((f) => (
            <label key={f.label} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{f.label}</span>
              <span className="flex gap-2">
                <Input type="date" value={f.value} onChange={(e) => f.set(e.target.value)} />
                {f.value && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => f.set("")}>
                    비우기
                  </Button>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{f.hint}</span>
            </label>
          ))}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

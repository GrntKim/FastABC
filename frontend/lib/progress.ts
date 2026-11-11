// Assignment stages as graders see them, and the one next action each stage offers.
import type { AssignmentSummary } from "./api";

export const STAGE_LABEL: Record<string, string> = {
  setup: "준비",
  grading: "AI 판단 중",
  review: "채점 중",
  done: "채점 끝",
  finalized: "성적 확정",
};

export const STAGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  setup: "outline",
  grading: "secondary",
  review: "default",
  done: "secondary",
  finalized: "outline",
};

/** A quiet dot per stage, for places where a filled badge is too loud (exam result column heads). */
export const STAGE_DOT: Record<string, string> = {
  setup: "bg-muted-foreground/40",
  grading: "bg-violet-500",
  review: "bg-primary",
  done: "bg-emerald-500",
  finalized: "bg-emerald-700",
};

/** What a question's stage invites, as a short link label (exam result column heads). */
export const STAGE_ACTION: Record<string, string> = {
  setup: "채점 시작",
  grading: "진행 보기",
  review: "채점하기",
  done: "성적 확정",
  finalized: "결과 보기",
};

export function nextAction(a: AssignmentSummary): string {
  const p = a.progress;
  if (p.stage === "setup") return p.submissions ? "채점 시작하기" : "답안 올리기";
  if (p.stage === "grading") return "진행 상황 보기";
  if (p.stage === "review") return "이어서 채점";
  if (p.stage === "done") return "성적 확정하기";
  return "결과 보기";
}

/** The sessions of an academic year, in calendar order. Codes match backend CourseIn.term. */
export const TERM_SESSIONS = [
  { code: "1", label: "1학기" },
  { code: "1S", label: "여름 계절학기" },
  { code: "2", label: "2학기" },
  { code: "2W", label: "겨울 계절학기" },
] as const;

/** "2026-2" -> "2026년 2학기", "2026-1S" -> "2026년 여름 계절학기"; other formats are shown as typed. */
export function termLabel(term: string): string {
  const m = /^(\d{4})-(\w+)$/.exec(term);
  const session = m && TERM_SESSIONS.find((s) => s.code === m[2]);
  return session ? `${m[1]}년 ${session.label}` : term;
}

/** The session running now: Mar–Jun 1학기, Jul–Aug 여름, Sep–Dec 2학기, Jan–Feb the previous year's 겨울. */
export function currentTerm(now = new Date()): string {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month <= 2) return `${year - 1}-2W`;
  if (month <= 6) return `${year}-1`;
  if (month <= 8) return `${year}-1S`;
  return `${year}-2`;
}

// Assignment stages as graders see them, and the one next action each stage offers.
import type { AssignmentSummary } from "./api";

export const STAGE_LABEL: Record<string, string> = {
  setup: "준비",
  grading: "판단 중",
  review: "검토 중",
  done: "검토 완료",
};

export const STAGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  setup: "outline",
  grading: "secondary",
  review: "default",
  done: "secondary",
};

export function nextAction(a: AssignmentSummary): string {
  const p = a.progress;
  if (p.stage === "setup") return p.submissions ? "채점 시작하기" : "답안 올리기";
  if (p.stage === "grading") return "진행 상황 보기";
  if (p.stage === "review") return p.attention ? `이어서 채점 (확인 필요 ${p.attention})` : "이어서 채점";
  return "결과 보기";
}

/** "2026-2" -> "2026년 2학기"; other formats are shown as typed. */
export function termLabel(term: string): string {
  const m = /^(\d{4})-(\d)$/.exec(term);
  return m ? `${m[1]}년 ${m[2]}학기` : term;
}

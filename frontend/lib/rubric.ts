// Display helpers for rubric items. Point rules mirror backend app/scoring.py.
import type { RubricItemOut } from "./api";

export const KIND_LABEL: Record<string, string> = { gate: "게이트", credit: "가점", deduction: "감점" };

export const ROUTE_LABEL: Record<string, string> = {
  pending: "재판단 중",
  skip: "주제 벗어남",
  auto: "자동",
  llm: "LLM 확인",
  human: "직접 판단",
};

export function formatPred(item: RubricItemOut, pred: unknown): string {
  if (pred === null || pred === undefined) return "—";
  if (item.type === "noul") return pred ? "예" : "아니오";
  if (item.type === "score") return `수준 ${pred}`;
  return String(pred);
}

/** Description of a score level or choice, for tooltips. */
export function describePred(item: RubricItemOut, pred: unknown): string | undefined {
  const criteria = item.criteria as unknown;
  if (item.type === "score" && Array.isArray(criteria) && typeof pred === "number") return criteria[pred];
  if (item.type === "choice" && criteria && typeof criteria === "object") {
    return (criteria as Record<string, string>)[String(pred)];
  }
  if (item.type === "noul" && criteria && typeof criteria === "object" && typeof pred === "boolean") {
    return (criteria as Record<string, string>)[String(pred)];
  }
  return undefined;
}

export type PointOption = { label: string; points: number };

/** Quick-entry buttons for one cell. */
export function pointOptions(item: RubricItemOut): PointOption[] {
  const points = item.points ?? 0;
  if (item.kind === "gate") return [{ label: "0점", points: 0 }];
  if (item.kind === "deduction") return [{ label: "없음 (0)", points: 0 }, { label: `있음 (−${points})`, points: -points }];
  if (item.type === "noul") return [{ label: "미충족 (0)", points: 0 }, { label: `충족 (${points})`, points }];
  return Object.entries(item.points_map ?? {}).map(([key, value]) => ({
    label: item.type === "score" ? `수준 ${key} (${value})` : `${key} (${value})`,
    points: value,
  }));
}

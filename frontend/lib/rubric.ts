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
  if (item.kind === "deduction") return [{ label: "없음 (0)", points: 0 }, { label: `있음 (−${points})`, points: -points }];
  if (item.type === "noul") return [{ label: "미충족 (0)", points: 0 }, { label: `충족 (${points})`, points }];
  return Object.entries(item.points_map ?? {}).map(([key, value]) => ({
    label: item.type === "score" ? `수준 ${key} (${value})` : `${key} (${value})`,
    points: value,
  }));
}

// One color per scored rubric item: evidence marks in the answer and the matching note share it.
// Literal class names so Tailwind picks them up.
export const ITEM_COLORS = [
  { mark: "bg-sky-200/80 dark:bg-sky-800/70", dot: "bg-sky-500", ring: "ring-sky-400" },
  { mark: "bg-amber-200/80 dark:bg-amber-800/70", dot: "bg-amber-500", ring: "ring-amber-400" },
  { mark: "bg-emerald-200/80 dark:bg-emerald-800/70", dot: "bg-emerald-500", ring: "ring-emerald-400" },
  { mark: "bg-rose-200/80 dark:bg-rose-800/70", dot: "bg-rose-500", ring: "ring-rose-400" },
  { mark: "bg-violet-200/80 dark:bg-violet-800/70", dot: "bg-violet-500", ring: "ring-violet-400" },
  { mark: "bg-lime-200/80 dark:bg-lime-800/70", dot: "bg-lime-500", ring: "ring-lime-400" },
  { mark: "bg-orange-200/80 dark:bg-orange-800/70", dot: "bg-orange-500", ring: "ring-orange-400" },
  { mark: "bg-cyan-200/80 dark:bg-cyan-800/70", dot: "bg-cyan-500", ring: "ring-cyan-400" },
];

export function itemColor(items: RubricItemOut[], itemId: number) {
  const scored = items.filter((i) => i.kind !== "gate");
  const index = scored.findIndex((i) => i.id === itemId);
  return index === -1 ? undefined : ITEM_COLORS[index % ITEM_COLORS.length];
}

/** Name shown to graders: the label, or the key when no label was given. */
export const itemName = (item: RubricItemOut) => item.label || item.key;

export const KIND_HINT: Record<string, string> = {
  gate: "주제 확인 질문: 확신 높은 '아니오'면 나머지 항목은 판단을 생략하고 0점을 추천합니다",
  credit: "충족하면 점수를 줍니다",
  deduction: "해당하면 점수를 깎습니다 (오개념 등)",
};

export const SAMPLED_HINT = "자동 판단 중 무작위로 뽑은 칸입니다. 일괄 수용에서 빠지니 직접 확인하세요.";

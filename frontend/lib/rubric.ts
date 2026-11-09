// Display helpers for rubric items. Point rules mirror backend app/scoring.py.
import type { RubricItemOut } from "./api";

export const KIND_LABEL: Record<string, string> = { gate: "주제 확인", credit: "가점", deduction: "감점" };

export const TYPE_LABEL: Record<string, string> = { noul: "충족 여부", score: "수준별", choice: "선택" };

// Particles written for a vowel-final word ("`answer`가") read wrong after 답안, which ends in a consonant
const AFTER_ANSWER: Record<string, string> = { 가: "이", 는: "은", 를: "을", 와: "과", 로: "으로", 라: "이라" };

/** Judge-question text for graders: `answer` / `question` placeholders read as plain words. */
export const plain = (text: string) =>
  text
    .replace(/`answer`(가|는|를|와|로|라)(?![가-힣])|`answer`(?=가|는|를|와|로|라)/g, (m, p?: string) =>
      p ? `답안${AFTER_ANSWER[p]}` : "답안",
    )
    .replaceAll("`answer`", "답안")
    .replaceAll("`question`", "문제")
    .replaceAll("`", "");

// "답안" used as a word on its own: start, space or quote before; a particle, space or punctuation after
const ANSWER_WORD = /(^|[\s(“"'‘])답안(?=[이가은는을를의에과와도만로으]|[\s.,)”"'’]|$)/g;

/**
 * Inverse of plain() for text a grader typed: "답안" goes back to the `answer` placeholder the judges read.
 * "문제" stays a plain word: it is also an ordinary noun in rubrics ("평문 저장의 문제").
 */
export const fromPlain = (text: string) => text.replace(ANSWER_WORD, "$1`answer`");

/** Description of a score level or choice, for tooltips. */
export function describePred(item: RubricItemOut, pred: unknown): string | undefined {
  const criteria = item.criteria as unknown;
  let text: string | undefined;
  if (item.type === "score" && Array.isArray(criteria) && typeof pred === "number") text = criteria[pred];
  else if (item.type === "choice" && criteria && typeof criteria === "object") {
    text = (criteria as Record<string, string>)[String(pred)];
  } else if (item.type === "noul" && criteria && typeof criteria === "object" && typeof pred === "boolean") {
    text = (criteria as Record<string, string>)[String(pred)];
  }
  return text && plain(text);
}

export type PointOption = { name: string; label: string; points: number };

const option = (name: string, points: number): PointOption => ({
  name,
  label: `${name} (${points < 0 ? `−${-points}` : points})`,
  points,
});

/** Quick-entry buttons for one cell: the grader picks an outcome, not a raw number. */
export function pointOptions(item: RubricItemOut): PointOption[] {
  const points = item.points ?? 0;
  if (item.kind === "deduction") return [option("해당 없음", 0), option("해당", -points)];
  if (item.type === "noul") return [option("미충족", 0), option("충족", points)];
  return Object.entries(item.points_map ?? {}).map(([key, value]) =>
    option(item.type === "score" ? `수준 ${key}` : key, value),
  );
}

/** Points a judgment is worth; mirrors item_points() in backend app/scoring.py. */
export function predPoints(item: RubricItemOut, pred: unknown): number | null {
  if (pred === null || pred === undefined) return null;
  if (item.kind === "deduction") return pred ? -(item.points ?? 0) : 0;
  if (item.type === "noul") return pred ? (item.points ?? 0) : 0;
  return item.points_map?.[String(pred)] ?? 0;
}

/** Most a credit item can add; deductions only take away, so their maximum is 0. */
export function itemMax(item: RubricItemOut): number {
  if (item.kind !== "credit") return 0;
  if (item.type === "noul") return item.points ?? 0;
  return Math.max(0, ...Object.values(item.points_map ?? {}));
}

/** Signed points as graders write them: −1, 0, 2.5 */
export const formatPoints = (points: number) => (points < 0 ? `−${-points}` : String(points));

/** The outcome's name alone, e.g. "충족" for a noul credit worth 2. */
export const outcomeName = (item: RubricItemOut, points: number) =>
  pointOptions(item).find((o) => o.points === points)?.name ?? "";

/** A score in the grader's words, e.g. "충족 · 2점". */
export function outcome(item: RubricItemOut, points: number | null): string {
  if (points === null) return "—";
  const name = pointOptions(item).find((o) => o.points === points)?.name;
  const value = `${points < 0 ? `−${-points}` : points}점`;
  return name ? `${name} · ${value}` : value;
}

/** Why an undecided cell needs the grader's eyes, in the grader's words; null when the recommendation can stand. */
export function checkReason(cell: { route: string; sampled: boolean }): string | null {
  if (cell.route === "pending") return "AI가 다시 보는 중";
  if (cell.route === "human") return "AI 의견이 갈림";
  if (cell.route === "llm") return "AI가 확신하지 못함";
  if (cell.sampled) return "무작위 점검";
  return null;
}

export const CHECK_HINT: Record<string, string> = {
  "AI가 다시 보는 중": "더 꼼꼼한 AI가 이 칸을 다시 판단하고 있습니다. 끝나면 추천이 나옵니다.",
  "AI 의견이 갈림": "두 AI의 판단이 달라 추천을 내지 않았습니다. 직접 점수를 고르세요.",
  "AI가 확신하지 못함": "처음 판단이 확실하지 않아 다시 판단했습니다. 추천이 있지만 확인해 주세요.",
  "무작위 점검": "확신이 높은 칸 중 무작위로 뽑았습니다. 일괄 확정에서 빠지니 직접 확인하세요.",
};

// Accent for a cell that needs a look: left edge on cards, chip color for the reason
export const CHECK_TONE: Record<string, { edge: string; chip: string }> = {
  "AI가 다시 보는 중": { edge: "border-l-amber-300", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  "AI 의견이 갈림": { edge: "border-l-rose-400", chip: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
  "AI가 확신하지 못함": { edge: "border-l-violet-400", chip: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  "무작위 점검": { edge: "border-l-amber-400", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
};

// One color per scored rubric item: evidence marks in the answer and the matching note share it.
// Literal class names so Tailwind picks them up. No yellow-family hues: the answer sits on yellow memo paper.
export const ITEM_COLORS = [
  { mark: "bg-sky-200/80 dark:bg-sky-800/70", dot: "bg-sky-500", ring: "ring-sky-400" },
  { mark: "bg-fuchsia-200/80 dark:bg-fuchsia-800/70", dot: "bg-fuchsia-500", ring: "ring-fuchsia-400" },
  { mark: "bg-emerald-200/80 dark:bg-emerald-800/70", dot: "bg-emerald-500", ring: "ring-emerald-400" },
  { mark: "bg-rose-200/80 dark:bg-rose-800/70", dot: "bg-rose-500", ring: "ring-rose-400" },
  { mark: "bg-violet-200/80 dark:bg-violet-800/70", dot: "bg-violet-500", ring: "ring-violet-400" },
  { mark: "bg-teal-200/80 dark:bg-teal-800/70", dot: "bg-teal-500", ring: "ring-teal-400" },
  { mark: "bg-indigo-200/80 dark:bg-indigo-800/70", dot: "bg-indigo-500", ring: "ring-indigo-400" },
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

/** How a cell was decided, in the screen glossary's words. */
export const DECISION_LABEL: Record<string, string> = { accepted: "추천 수용", modified: "수정", manual: "직접 입력" };

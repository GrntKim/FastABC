"use client";

import type { CellOut, RubricItemOut } from "@/lib/api";
import { DECISION_LABEL, describePred, formatPoints, outcomeName, pointOptions, predPoints, type PointOption } from "@/lib/rubric";
import { cn } from "@/lib/utils";

/** What the rubric says this option means, for the button tooltip. */
function hint(item: RubricItemOut, o: PointOption): string | undefined {
  if (item.type === "score") return describePred(item, Number(o.name.replace("수준 ", "")));
  if (item.type === "choice") return describePred(item, o.name);
  return describePred(item, o.points !== 0); // noul, including deductions
}

/** The two judges, named at their options: apart on a split cell, together on a re-checked one. */
function judgeMarks(item: RubricItemOut, cell: CellOut): Map<number, string[]> {
  const marks = new Map<number, string[]>();
  if (cell.route !== "human" && cell.route !== "llm") return marks;
  for (const [name, pred] of [["1차", cell.primary?.pred] as const, ["재확인", cell.secondary?.pred] as const]) {
    const points = predPoints(item, pred);
    if (points !== null) marks.set(points, [...(marks.get(points) ?? []), name]);
  }
  return marks;
}

/**
 * Every score this item can get, as one row of cells: picking one is deciding, and the picked
 * cell stays filled right where it was clicked. The AI's recommendation is only outlined, never
 * pre-filled; on a split cell the two judgments are named under their options instead.
 */
export function PointPicker({
  item,
  cell,
  disabled,
  onPick,
}: {
  item: RubricItemOut;
  cell: CellOut;
  disabled: boolean;
  onPick: (points: number) => void;
}) {
  const options = pointOptions(item);
  const marks = judgeMarks(item, cell);
  const named = marks.size > 0;
  const decided = cell.final_points !== null;
  return (
    <div className={cn("inline-flex rounded-lg border bg-card", named ? "items-stretch" : "items-center")} role="group">
      {options.map((o, i) => {
        const chosen = decided && cell.final_points === o.points;
        const recommended = cell.recommended_points !== null && cell.recommended_points === o.points;
        return (
          <button
            key={o.label}
            type="button"
            disabled={disabled || chosen}
            onClick={() => onPick(o.points)}
            title={
              chosen
                ? (cell.decision && `${DECISION_LABEL[cell.decision]}로 확정했습니다`) || undefined
                : [recommended ? "AI 추천" : undefined, hint(item, o)].filter(Boolean).join(" · ") || undefined
            }
            className={cn(
              "flex min-w-14 flex-col items-center justify-center gap-0 px-2.5 py-1 text-xs leading-tight transition-colors",
              i > 0 && "border-l",
              i === 0 && "rounded-l-[calc(var(--radius-lg)-1px)]",
              i === options.length - 1 && "rounded-r-[calc(var(--radius-lg)-1px)]",
              chosen
                ? "bg-primary text-primary-foreground"
                : cn(
                    "text-muted-foreground hover:bg-muted hover:text-foreground disabled:hover:bg-transparent",
                    decided && "opacity-60 hover:opacity-100",
                  ),
              // the recommendation is visible but never pre-filled: a dashed line under its name
              recommended && !decided && "text-foreground [&>span:first-child]:underline [&>span:first-child]:decoration-dashed [&>span:first-child]:decoration-primary [&>span:first-child]:underline-offset-4",
            )}
          >
            <span className="whitespace-nowrap">{o.name}</span>
            <span className={cn("text-sm font-semibold tabular-nums", o.points < 0 && !chosen && "text-rose-600 dark:text-rose-400")}>
              {chosen && "✓ "}
              {formatPoints(o.points)}
            </span>
            {named && (
              <span
                className={cn(
                  "whitespace-nowrap text-[0.65rem]",
                  chosen
                    ? "text-primary-foreground/80"
                    : cell.route === "llm"
                      ? "text-violet-700/80 dark:text-violet-300/80"
                      : "text-rose-600/80 dark:text-rose-400/80",
                )}
              >
                {marks.get(o.points)?.join(" · ") ?? " "}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A split cell's two judgments as cards side by side: what each AI decided and why. A card is also a
 * way to pick its side; the picked one turns green and the other fades.
 */
export function JudgeCards({
  item,
  cell,
  disabled,
  stacked = false,
  onPick,
}: {
  item: RubricItemOut;
  cell: CellOut;
  disabled: boolean;
  stacked?: boolean; // narrow column: one card above the other
  onPick: (points: number) => void;
}) {
  if (cell.route !== "human") return null;
  if (!cell.secondary) return <p className="text-muted-foreground">재확인이 끝나지 않아 추천이 없습니다. 직접 고르세요.</p>;
  const sides = [
    { name: "1차 판단", hint: "모든 항목을 빠르게 판단하는 AI의 결과입니다.", view: cell.primary },
    { name: "재확인", hint: "1차 판단이 확신하지 못한 항목만 다시 읽은 AI의 결과입니다.", view: cell.secondary },
  ];
  return (
    <div className={cn("grid gap-2", !stacked && "sm:grid-cols-2")}>
      {sides.map((side) => {
        const points = predPoints(item, side.view?.pred);
        const chosen = points !== null && cell.final_points === points;
        const faded = cell.final_points !== null && !chosen;
        return (
          <button
            key={side.name}
            type="button"
            disabled={disabled || points === null || chosen}
            onClick={() => onPick(points!)}
            className={cn(
              "group/side flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
              chosen
                ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30"
                : "border-rose-200 bg-rose-50/30 hover:border-primary disabled:hover:border-rose-200 dark:border-rose-900 dark:bg-rose-950/10",
              faded && "opacity-50",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-xs font-medium text-rose-700 dark:text-rose-300" title={side.hint}>
                {side.name}
              </span>
              <span
                className={cn(
                  "ml-auto text-xs",
                  chosen ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-primary/60 group-hover/side:text-primary",
                  points === null && "hidden",
                )}
              >
                {chosen ? "✓ 확정" : "이 판단으로 확정"}
              </span>
            </span>
            {points === null ? (
              <strong className="text-muted-foreground">판단 없음</strong>
            ) : (
              <strong className="text-base">
                {outcomeName(item, points)} · {formatPoints(points)}점
              </strong>
            )}
            <span className="text-sm text-muted-foreground">{side.view?.reasoning ?? describePred(item, side.view?.pred)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Why a confident item is up for a look: it was drawn for the random audit. Said where the grader
 * sees it, since a confident item asking for attention otherwise looks like a mistake.
 */
export function SampleNote({ cell, brief = false }: { cell: CellOut; brief?: boolean }) {
  // gone once decided, like the reason chip: it explains why to look, not what was done
  if (!cell.sampled || cell.route !== "auto" || cell.final_points !== null) return null;
  // said once in full per student; the rest only point back to it
  if (brief) return <p className="text-xs text-amber-800 dark:text-amber-300">무작위 점검 항목입니다. 추천이 맞으면 그 점수를 누르세요.</p>;
  return (
    <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      AI가 확신한 항목입니다. AI 판단이 정말 맞는지 확인하려고, 답안 열 개 중 하나꼴로 확신한 항목 하나를 무작위로 골라 보여 드립니다.
      점선 밑줄 친 점수가 추천이니, 맞으면 그 점수를 누르세요.
    </p>
  );
}

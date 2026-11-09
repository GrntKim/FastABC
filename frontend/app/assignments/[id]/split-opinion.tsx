"use client";

import type { CellOut, RubricItemOut } from "@/lib/api";
import { describePred, formatPoints, outcomeName, pointOptions, predPoints, type PointOption } from "@/lib/rubric";
import { cn } from "@/lib/utils";

/** Point buttons still worth showing: on a split cell, the two sides already have their own button. */
export function otherOptions(item: RubricItemOut, cell: CellOut): PointOption[] {
  const options = pointOptions(item);
  if (cell.route !== "human" || !cell.secondary) return options;
  const sides = [predPoints(item, cell.primary?.pred), predPoints(item, cell.secondary.pred)];
  return options.filter((o) => !sides.includes(o.points));
}

/**
 * A cell where the first judgment and the re-check disagree: both side by side, either one a click away.
 * The system does not pick between them; the grader does.
 */
export default function SplitOpinion({
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
  if (!cell.secondary) {
    return <p className="text-muted-foreground">재확인이 끝나지 않아 추천이 없습니다. 직접 고르세요.</p>;
  }
  const sides = [
    {
      title: "1차 판단",
      hint: "모든 항목을 빠르게 판단하는 AI의 결과입니다.",
      points: predPoints(item, cell.primary?.pred),
      why: describePred(item, cell.primary?.pred),
    },
    {
      title: "재확인",
      hint: "1차 판단이 확신하지 못한 항목만 다시 읽은 AI의 결과입니다.",
      points: predPoints(item, cell.secondary.pred),
      why: cell.secondary.reasoning ?? describePred(item, cell.secondary.pred),
    },
  ];

  return (
    <div className={cn("grid gap-2", !stacked && "sm:grid-cols-2")}>
      {sides.map((side) => {
        const chosen = side.points !== null && cell.final_points === side.points;
        const other = cell.final_points !== null && !chosen;
        return (
          // the whole card is the choice: one click on the side the grader agrees with
          <button
            key={side.title}
            type="button"
            disabled={disabled || side.points === null || chosen}
            onClick={() => onPick(side.points!)}
            className={cn(
              "group/side flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
              chosen
                ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30"
                : "hover:border-primary hover:bg-muted/40 disabled:hover:border-border disabled:hover:bg-transparent",
              other && "opacity-50",
            )}
          >
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground" title={side.hint}>
                {side.title}
              </span>
              {side.points === null ? (
                <strong className="text-muted-foreground">판단 없음</strong>
              ) : (
                <strong>
                  {outcomeName(item, side.points)} · {formatPoints(side.points)}점
                </strong>
              )}
              <span
                className={cn(
                  "ml-auto text-xs",
                  chosen ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-primary/60 group-hover/side:text-primary",
                  side.points === null && "hidden",
                )}
              >
                {chosen ? "✓ 확정" : "이 판단으로 확정"}
              </span>
            </span>
            {side.why && <span className="text-sm text-muted-foreground">{side.why}</span>}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { Button } from "@/components/ui/button";
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
      hint: "모든 칸을 빠르게 판단하는 AI의 결과입니다.",
      points: predPoints(item, cell.primary?.pred),
      why: describePred(item, cell.primary?.pred),
    },
    {
      title: "재확인",
      hint: "1차 판단이 확신하지 못한 칸만 다시 읽은 AI의 결과입니다.",
      points: predPoints(item, cell.secondary.pred),
      why: cell.secondary.reasoning ?? describePred(item, cell.secondary.pred),
    },
  ];

  return (
    <div className={cn("grid gap-2", !stacked && "sm:grid-cols-2")}>
      {sides.map((side) => (
        <div key={side.title} className="flex flex-col gap-1.5 rounded-lg border border-rose-200 bg-rose-50/40 p-3 dark:border-rose-900 dark:bg-rose-950/20">
          <span className="text-xs font-medium text-rose-800 dark:text-rose-300" title={side.hint}>
            {side.title}
          </span>
          {side.points === null ? (
            <strong className="text-muted-foreground">판단 없음</strong>
          ) : (
            <div className="flex items-baseline gap-2">
              <strong className="text-base">{outcomeName(item, side.points)}</strong>
              <span className="text-lg font-bold tabular-nums">{formatPoints(side.points)}점</span>
            </div>
          )}
          {side.why && <p className="text-sm text-muted-foreground">{side.why}</p>}
          {side.points !== null && (
            <Button
              size="sm"
              variant="outline"
              className="mt-auto self-start"
              disabled={disabled || cell.final_points === side.points}
              onClick={() => onPick(side.points!)}
            >
              이 판단으로 확정
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

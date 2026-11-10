"use client";

import { Button } from "@/components/ui/button";
import { StudentTag } from "@/components/student";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CellOut, GradeDecisionIn, RubricItemOut } from "@/lib/api";
import { highlight } from "@/lib/highlight";
import { CHECK_HINT, CHECK_TONE, checkReason, describePred } from "@/lib/rubric";
import { useDecide } from "@/lib/use-decide";
import { cn } from "@/lib/utils";
import { JudgeCards, PointPicker } from "@/components/point-picker";

export default function CellCard({
  assignmentId,
  cell,
  item,
  locked,
}: {
  assignmentId: number;
  cell: CellOut;
  item: RubricItemOut;
  locked: boolean; // grades are finalized
}) {
  const mutation = useDecide(assignmentId);
  const decide = { isPending: mutation.isPending || locked, mutate: (body: GradeDecisionIn) => mutation.mutate({ gradeId: cell.grade_id, body }) };

  const llm = cell.secondary ?? cell.evidence;
  const evidence = llm?.evidence ?? [];
  const decided = cell.final_points !== null;
  const pending = cell.route === "pending";
  const reason = decided ? null : checkReason(cell);
  const judge = cell.secondary && cell.route !== "auto" ? cell.secondary : cell.primary;
  const why = cell.route === "skip" ? "답안이 문제와 관련 없어 판단하지 않았습니다." : (llm?.reasoning ?? describePred(item, judge?.pred));

  return (
    <Card className={cn(reason && cn("border-l-4", CHECK_TONE[reason].edge), decided && "opacity-70")}>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle>
          <StudentTag student={cell} />
        </CardTitle>
        {reason && (
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", CHECK_TONE[reason].chip)} title={CHECK_HINT[reason]}>
            {reason}
          </span>
        )}
        {decided && <span className="ml-auto text-sm text-emerald-700 dark:text-emerald-400">✓ 확정</span>}
      </CardHeader>

      <CardContent className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <p className="answer-sheet self-start whitespace-pre-wrap rounded-sm px-3 ring-1 ring-stone-300 dark:ring-stone-700">
          {cell.answer
            ? highlight(cell.answer, evidence).map((s, i) =>
                s.marked ? (
                  <mark key={i} className="rounded bg-sky-200/80 px-0.5 text-inherit dark:bg-sky-800/70">
                    {s.text}
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )
            : <span className="text-muted-foreground">(빈 답안)</span>}
        </p>

        <div className="flex flex-col gap-3 text-sm">
          {cell.route === "human" ? (
            <JudgeCards
              item={item}
              cell={cell}
              disabled={decide.isPending}
              stacked
              onPick={(points) => decide.mutate({ action: "set", points })}
            />
          ) : (
            why && <p className="text-muted-foreground">{why}</p>
          )}

          {pending ? (
            <p className="text-muted-foreground">AI가 다시 보는 중입니다. 끝나면 고를 수 있습니다.</p>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <PointPicker item={item} cell={cell} disabled={decide.isPending} onPick={(points) => decide.mutate({ action: "set", points })} />
              {decided && !locked && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ action: "clear" })}
                >
                  확정 취소
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

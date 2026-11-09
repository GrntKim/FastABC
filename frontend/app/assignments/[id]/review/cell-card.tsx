"use client";

import { Button } from "@/components/ui/button";
import { StudentTag } from "@/components/student";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CellOut, GradeDecisionIn, RubricItemOut } from "@/lib/api";
import { highlight } from "@/lib/highlight";
import { CHECK_HINT, CHECK_TONE, checkReason, DECISION_LABEL, describePred, outcome } from "@/lib/rubric";
import { useDecide } from "@/lib/use-decide";
import { cn } from "@/lib/utils";
import SplitOpinion, { otherOptions } from "../split-opinion";

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
        {decided && (
          <span className="ml-auto text-sm">
            <span className="text-emerald-700 dark:text-emerald-400">✓</span> <strong>{outcome(item, cell.final_points)}</strong>
            <span className="text-muted-foreground"> · {cell.decision && DECISION_LABEL[cell.decision]}</span>
          </span>
        )}
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
            <SplitOpinion
              item={item}
              cell={cell}
              disabled={decide.isPending}
              stacked
              onPick={(points) => decide.mutate({ action: "set", points })}
            />
          ) : (
            <div>
              {cell.recommended_points !== null && (
                <p title={cell.primary?.conf != null ? `첫 판단 확신도 ${Math.round(cell.primary.conf * 100)}%` : undefined}>
                  추천 <strong>{outcome(item, cell.recommended_points)}</strong>
                </p>
              )}
              {why && <p className="text-muted-foreground">{why}</p>}
            </div>
          )}

          {pending ? (
            <p className="text-muted-foreground">AI가 다시 보는 중입니다. 끝나면 고를 수 있습니다.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {!decided &&
                (cell.recommended_points !== null ? (
                  <Button
                    // a cell nobody needs to check is quiet: bulk confirm handles it
                    variant={reason ? "default" : "secondary"}
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ action: "accept" })}
                  >
                    추천대로 확정
                  </Button>
                ) : (
                  cell.route !== "human" && <p className="text-muted-foreground">추천 없음: 직접 고르세요.</p>
                ))}
              <div className="flex flex-wrap gap-1">
                {otherOptions(item, cell).map((o) => {
                  const recommended = o.points === cell.recommended_points;
                  return (
                    <Button
                      key={o.label}
                      size="sm"
                      variant={cell.final_points === o.points ? "default" : "outline"}
                      className={cn(recommended && !decided && "ring-2 ring-primary/40")}
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ action: "set", points: o.points })}
                    >
                      {o.label}
                      {recommended && <span className="ml-1 text-[0.65rem] opacity-70">추천</span>}
                    </Button>
                  );
                })}
              </div>
              {decided && !locked && (
                <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ action: "clear" })}>
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

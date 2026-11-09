"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CellOut, GradeDecisionIn, RubricItemOut } from "@/lib/api";
import { highlight } from "@/lib/highlight";
import { confLabel, describePred, formatPred, pointOptions, ROUTE_LABEL, ROUTE_TONE, SAMPLED_HINT } from "@/lib/rubric";
import { useDecide } from "@/lib/use-decide";
import { cn } from "@/lib/utils";

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

  const evidence = (cell.secondary ?? cell.evidence)?.evidence ?? [];
  const decided = cell.final_points !== null;
  const pending = cell.route === "pending";

  // undecided cells the grader must look at get an accent edge, as in the student view
  const accent =
    !decided &&
    (cell.route === "human"
      ? "border-l-4 border-l-rose-400"
      : cell.route === "llm"
        ? "border-l-4 border-l-violet-400"
        : cell.sampled && "border-l-4 border-l-amber-400");

  return (
    <Card className={cn(accent, decided && "opacity-70")}>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="font-mono">{cell.label}</CardTitle>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ROUTE_TONE[cell.route])}>
          {ROUTE_LABEL[cell.route] ?? cell.route}
        </span>
        {cell.sampled && (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            title={SAMPLED_HINT}
          >
            샘플 검토
          </span>
        )}
        {decided && (
          <span className="ml-auto text-sm">
            확정 <strong>{cell.final_points}점</strong>
            <span className="text-muted-foreground"> · {decisionLabel(cell.decision)}</span>
          </span>
        )}
      </CardHeader>

      <CardContent className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <p className="self-start whitespace-pre-wrap rounded-md bg-yellow-50 p-3 leading-relaxed ring-1 ring-yellow-300/60 dark:bg-yellow-950/30 dark:ring-yellow-800/50">
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
          <JudgeLine
            title="판단 모델"
            pred={cell.primary ? formatPred(item, cell.primary.pred) : "—"}
            detail={describePred(item, cell.primary?.pred)}
            extra={cell.primary?.conf != null ? confLabel(cell.primary.conf) : undefined}
          />
          {cell.secondary && (
            <JudgeLine
              title={cell.route === "human" ? "LLM (참고)" : "LLM"}
              pred={formatPred(item, cell.secondary.pred)}
              detail={cell.secondary.reasoning ?? undefined}
            />
          )}

          {pending ? (
            <p className="text-muted-foreground">LLM 재판단이 끝나면 입력할 수 있습니다.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {cell.recommended_points !== null ? (
                <Button
                  // confident auto cells can go through bulk accept: keep their button quiet
                  variant={cell.route === "auto" && !cell.sampled ? "secondary" : "default"}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ action: "accept" })}
                >
                  추천 수용 ({cell.recommended_points}점)
                </Button>
              ) : (
                <p className="text-muted-foreground">추천 없음: 직접 판단하세요.</p>
              )}
              <div className="flex flex-wrap gap-1">
                {pointOptions(item).map((o) => (
                  <Button
                    key={o.label}
                    size="sm"
                    variant={cell.final_points === o.points ? "secondary" : "outline"}
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ action: "set", points: o.points })}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
              {decided && (
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

function JudgeLine({ title, pred, detail, extra }: { title: string; pred: string; detail?: string; extra?: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground">{title}</span>
        <strong>{pred}</strong>
        {extra && <span className="text-muted-foreground">{extra}</span>}
      </div>
      {detail && <p className="text-muted-foreground">{detail}</p>}
    </div>
  );
}

function decisionLabel(decision: string | null): string {
  return { accepted: "추천 수용", modified: "수정", manual: "직접 입력" }[decision ?? ""] ?? "";
}

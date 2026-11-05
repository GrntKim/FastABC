"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError, json, type CellOut, type GradeDecisionIn, type RubricItemOut } from "@/lib/api";
import { highlight } from "@/lib/highlight";
import { describePred, formatPred, pointOptions, ROUTE_LABEL } from "@/lib/rubric";

const ROUTE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  auto: "secondary",
  skip: "outline",
  llm: "default",
  human: "destructive",
  pending: "outline",
};

export default function CellCard({
  assignmentId,
  cell,
  item,
}: {
  assignmentId: number;
  cell: CellOut;
  item: RubricItemOut;
}) {
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (body: GradeDecisionIn) => api<CellOut>(`/grades/${cell.grade_id}`, json(body, "PATCH")),
    onSuccess: (updated) => {
      queryClient.setQueryData<CellOut[]>(["cells", assignmentId], (cells) =>
        cells?.map((c) => (c.grade_id === updated.grade_id ? updated : c)),
      );
      queryClient.invalidateQueries({ queryKey: ["results", assignmentId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? String(e.detail) : "저장하지 못했습니다"),
  });

  const evidence = cell.gemini?.evidence ?? [];
  const decided = cell.final_points !== null;
  const pending = cell.route === "pending";

  return (
    <Card className={decided ? "opacity-70" : undefined}>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="font-mono">{cell.label}</CardTitle>
        <Badge variant={ROUTE_VARIANT[cell.route]}>{ROUTE_LABEL[cell.route] ?? cell.route}</Badge>
        {cell.sampled && <Badge variant="outline">샘플 검토</Badge>}
        {decided && (
          <span className="ml-auto text-sm">
            확정 <strong>{cell.final_points}점</strong>
            <span className="text-muted-foreground"> · {decisionLabel(cell.decision)}</span>
          </span>
        )}
      </CardHeader>

      <CardContent className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <p className="whitespace-pre-wrap leading-relaxed">
          {cell.answer
            ? highlight(cell.answer, evidence).map((s, i) =>
                s.marked ? (
                  <mark key={i} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-700">
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
            title="Jev"
            pred={cell.jev ? formatPred(item, cell.jev.pred) : "—"}
            detail={describePred(item, cell.jev?.pred)}
            extra={cell.jev?.conf != null ? `확신도 ${Math.round(cell.jev.conf * 100)}%` : undefined}
          />
          {cell.gemini && (
            <JudgeLine
              title={cell.route === "human" ? "Gemini (참고)" : "Gemini"}
              pred={formatPred(item, cell.gemini.pred)}
              detail={cell.gemini.reasoning ?? undefined}
            />
          )}

          {pending ? (
            <p className="text-muted-foreground">LLM 재판단이 끝나면 입력할 수 있습니다.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {cell.recommended_points !== null ? (
                <Button
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
                <Button size="sm" variant="ghost" onClick={() => decide.mutate({ action: "clear" })}>
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

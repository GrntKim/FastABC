"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  api,
  ApiError,
  type AssignmentOut,
  type CellOut,
  type GradingStatus,
  type RubricItemOut,
} from "@/lib/api";
import { termLabel } from "@/lib/progress";
import { checkReason, itemName, KIND_HINT, KIND_LABEL, plain } from "@/lib/rubric";
import { useAcceptConfident, useClearDecisions } from "@/lib/use-decide";
import CellCard from "./cell-card";

const FILTERS = {
  check: { label: "확인 필요", match: (c: CellOut) => c.final_points === null && checkReason(c) !== null },
  open: { label: "미확정", match: (c: CellOut) => c.final_points === null },
  all: { label: "전체", match: () => true },
} satisfies Record<string, { label: string; match: (c: CellOut) => boolean }>;
type Filter = keyof typeof FILTERS;

export default function ReviewScreen({ assignmentId }: { assignmentId: number }) {
  const queryClient = useQueryClient();
  const assignment = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api<AssignmentOut>(`/assignments/${assignmentId}`),
  });
  const status = useQuery({
    queryKey: ["grading", assignmentId],
    queryFn: () => api<GradingStatus>(`/assignments/${assignmentId}/grading`),
    refetchInterval: (q) => (q.state.data && !q.state.data.done ? 2000 : false),
  });
  const cells = useQuery({
    queryKey: ["cells", assignmentId],
    queryFn: () => api<CellOut[]>(`/assignments/${assignmentId}/cells`),
  });

  // pending cells change while the LLM re-judgment runs: refresh once it finishes
  const done = status.data?.done;
  useEffect(() => {
    if (done) queryClient.invalidateQueries({ queryKey: ["cells", assignmentId] });
  }, [done, assignmentId, queryClient]);

  const [tab, setTab] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("check");

  if (assignment.error || cells.error) {
    const e = assignment.error ?? cells.error;
    return <p className="text-destructive">{e instanceof ApiError ? String(e.detail) : "불러오지 못했습니다"}</p>;
  }
  if (!assignment.data || !cells.data) return <p className="text-muted-foreground">불러오는 중…</p>;

  // the gate question carries no points and has no cells to decide
  const items = assignment.data.items.filter((i) => i.kind !== "gate");
  const current = tab ?? String(items[0]?.id);
  const open = (itemId: number) => cells.data.filter((c) => c.rubric_item_id === itemId && c.final_points === null).length;
  const decided = cells.data.filter((c) => c.final_points !== null).length;
  const a = assignment.data;
  const locked = a.progress.stage === "finalized";

  return (
    <div className="flex flex-col gap-4">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          과목
        </Link>{" "}
        › {termLabel(a.course.term)} ›{" "}
        <Link href={`/courses/${a.course.id}`} className="hover:underline">
          {a.course.name} ({a.course.section}분반)
        </Link>{" "}
        ›{" "}
        <Link href={`/assignments/${assignmentId}`} className="hover:underline">
          {a.title}
        </Link>
      </nav>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{a.title} · 항목별 보기</h1>
        <p className="text-muted-foreground whitespace-pre-wrap">{a.problem}</p>
        <p className="text-sm">
          확정 {decided} / {cells.data.length}칸
          {status.data && !status.data.done && (
            <span className="text-muted-foreground"> · AI가 {status.data.pending}칸을 다시 보는 중</span>
          )}
          {locked && <span className="text-muted-foreground"> · 성적이 확정되어 잠겼습니다 (개정은 문항 화면의 결과 탭)</span>}
        </p>
      </header>

      {cells.data.length === 0 ? (
        <p className="text-muted-foreground">아직 채점하지 않았습니다.</p>
      ) : (
        <Tabs value={current} onValueChange={(v) => setTab(String(v))}>
          <TabsList className="w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
            {items.map((item) => (
              <TabsTrigger key={item.id} value={String(item.id)} className="h-7 flex-none gap-1">
                {itemName(item)}
                {open(item.id) > 0 && <Badge variant="secondary">{open(item.id)}</Badge>}
              </TabsTrigger>
            ))}
          </TabsList>

          {items.map((item) => (
            <TabsContent key={item.id} value={String(item.id)}>
              <ItemPanel
                assignmentId={assignmentId}
                item={item}
                cells={cells.data.filter((c) => c.rubric_item_id === item.id && FILTERS[filter].match(c))}
                filter={filter}
                onFilter={setFilter}
                locked={locked}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function ItemPanel({
  assignmentId,
  item,
  cells,
  filter,
  onFilter,
  locked,
}: {
  assignmentId: number;
  item: RubricItemOut;
  cells: CellOut[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  locked: boolean; // grades are finalized
}) {
  const acceptConfident = useAcceptConfident(assignmentId);
  const clearDecisions = useClearDecisions(assignmentId);

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" title={KIND_HINT[item.kind]}>
            {KIND_LABEL[item.kind]}
          </Badge>
          <span className="font-medium">{plain(item.instructions)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} onClick={() => onFilter(f)}>
            {FILTERS[f].label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={acceptConfident.isPending || locked}
          onClick={() => acceptConfident.mutate({ item_id: item.id })}
          title="확인이 필요 없는 칸만 추천대로 확정합니다. 확인 필요로 표시된 칸은 그대로 둡니다."
        >
          추천대로 확정 (확인 필요 칸 제외)
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={clearDecisions.isPending || locked}
          onClick={() =>
            confirm(`'${itemName(item)}' 항목의 확정을 모든 답안에서 취소할까요? 직접 고른 점수도 지워집니다.`) &&
            clearDecisions.mutate({ item_id: item.id })
          }
        >
          모두 취소
        </Button>
      </div>

      {cells.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center">
          {filter === "check" ? "이 항목에는 확인이 필요한 칸이 없습니다. 남은 칸은 추천대로 확정하면 됩니다." : "해당하는 칸이 없습니다."}
        </p>
      ) : (
        cells.map((cell) => <CellCard key={cell.grade_id} assignmentId={assignmentId} cell={cell} item={item} locked={locked} />)
      )}
    </div>
  );
}

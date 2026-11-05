"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { KIND_LABEL } from "@/lib/rubric";
import CellCard from "./cell-card";
import ResultsPanel from "./results-panel";

const FILTERS = {
  all: { label: "전체", match: () => true },
  open: { label: "미확정", match: (c: CellOut) => c.final_points === null },
  llm: { label: "LLM 확인", match: (c: CellOut) => c.route === "llm" },
  human: { label: "직접 판단", match: (c: CellOut) => c.route === "human" },
  sampled: { label: "샘플 검토", match: (c: CellOut) => c.sampled },
} satisfies Record<string, { label: string; match: (c: CellOut) => boolean }>;
type Filter = keyof typeof FILTERS;

const RESULTS_TAB = "results";

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
  const [filter, setFilter] = useState<Filter>("open");

  if (assignment.error || cells.error) {
    const e = assignment.error ?? cells.error;
    return <p className="text-destructive">{e instanceof ApiError ? String(e.detail) : "불러오지 못했습니다"}</p>;
  }
  if (!assignment.data || !cells.data) return <p className="text-muted-foreground">불러오는 중…</p>;

  const items = assignment.data.items;
  // start on the first scored item: gate cells rarely need a look
  const current = tab ?? String((items.find((i) => i.kind !== "gate") ?? items[0])?.id);
  const open = (itemId: number) => cells.data.filter((c) => c.rubric_item_id === itemId && c.final_points === null).length;
  const decided = cells.data.filter((c) => c.final_points !== null).length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{assignment.data.title}</h1>
        <p className="text-muted-foreground whitespace-pre-wrap">{assignment.data.problem}</p>
        <p className="text-sm">
          확정 {decided} / {cells.data.length}칸
          {status.data && !status.data.done && (
            <span className="text-muted-foreground"> · LLM 재판단 {status.data.pending}칸 진행 중</span>
          )}
        </p>
      </header>

      {cells.data.length === 0 ? (
        <p className="text-muted-foreground">아직 채점하지 않았습니다.</p>
      ) : (
        <Tabs value={current} onValueChange={(v) => setTab(String(v))}>
          <TabsList className="w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
            {items.map((item) => (
              <TabsTrigger key={item.id} value={String(item.id)} className="h-7 flex-none gap-1">
                {item.key}
                {open(item.id) > 0 && <Badge variant="secondary">{open(item.id)}</Badge>}
              </TabsTrigger>
            ))}
            <TabsTrigger value={RESULTS_TAB} className="h-7 flex-none">
              결과
            </TabsTrigger>
          </TabsList>

          {items.map((item) => (
            <TabsContent key={item.id} value={String(item.id)}>
              <ItemPanel
                assignmentId={assignmentId}
                item={item}
                cells={cells.data.filter((c) => c.rubric_item_id === item.id && FILTERS[filter].match(c))}
                filter={filter}
                onFilter={setFilter}
              />
            </TabsContent>
          ))}
          <TabsContent value={RESULTS_TAB}>
            <ResultsPanel assignmentId={assignmentId} />
          </TabsContent>
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
}: {
  assignmentId: number;
  item: RubricItemOut;
  cells: CellOut[];
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  const queryClient = useQueryClient();
  const acceptConfident = useMutation({
    mutationFn: () =>
      api<{ accepted: number }>(`/assignments/${assignmentId}/accept-confident?item_id=${item.id}`, { method: "POST" }),
    onSuccess: ({ accepted }) => {
      toast.success(`${accepted}칸을 수용했습니다`);
      queryClient.invalidateQueries({ queryKey: ["cells", assignmentId] });
      queryClient.invalidateQueries({ queryKey: ["results", assignmentId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? String(e.detail) : "일괄 수용에 실패했습니다"),
  });

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{KIND_LABEL[item.kind]}</Badge>
          <span className="font-medium">{item.instructions}</span>
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
          disabled={acceptConfident.isPending}
          onClick={() => acceptConfident.mutate()}
          title="자동 판단 중 확신 높은 칸만 수용합니다. LLM 확인·직접 판단·샘플 검토 칸은 제외됩니다."
        >
          고확신 일괄 수용
        </Button>
      </div>

      {cells.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center">해당하는 칸이 없습니다.</p>
      ) : (
        cells.map((cell) => <CellCard key={cell.grade_id} assignmentId={assignmentId} cell={cell} item={item} />)
      )}
    </div>
  );
}

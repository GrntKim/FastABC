"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, json, type CellOut, type GradeDecisionIn } from "./api";

/** Confirm, change, or clear one cell's points, then patch the cached cell lists. */
export function useDecide(assignmentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ gradeId, body }: { gradeId: number; body: GradeDecisionIn }) =>
      api<CellOut>(`/grades/${gradeId}`, json(body, "PATCH")),
    onSuccess: (updated) => {
      // every cached cell list of this assignment (all cells, or filtered by submission)
      queryClient.setQueriesData<CellOut[]>({ queryKey: ["cells", assignmentId] }, (cells) =>
        cells?.map((c) => (c.grade_id === updated.grade_id ? updated : c)),
      );
      queryClient.invalidateQueries({ queryKey: ["results", assignmentId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? String(e.detail) : "저장하지 못했습니다"),
  });
}

/** Accept confident (auto/skip, not sampled) cells, optionally for one item or one submission. */
export function useAcceptConfident(assignmentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filter: { item_id?: number; submission_id?: number }) => {
      const params = new URLSearchParams(Object.entries(filter).map(([k, v]) => [k, String(v)]));
      return api<{ accepted: number }>(`/assignments/${assignmentId}/accept-confident?${params}`, { method: "POST" });
    },
    onSuccess: ({ accepted }) => {
      toast.success(`${accepted}칸을 수용했습니다`);
      queryClient.invalidateQueries({ queryKey: ["cells", assignmentId] });
      queryClient.invalidateQueries({ queryKey: ["results", assignmentId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? String(e.detail) : "일괄 수용에 실패했습니다"),
  });
}

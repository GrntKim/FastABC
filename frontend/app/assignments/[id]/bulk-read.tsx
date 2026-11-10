"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SegmentBar, SegmentLegend, type Segment } from "@/components/segment-bar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, json, type GradingStatus, type SubmissionOut } from "@/lib/api";
import { cn } from "@/lib/utils";

type Status = "waiting" | "reading" | "read" | "failed" | "saving" | "saved";
type Row = {
  key: string;
  file: File;
  url: string; // a local preview of the original
  studentId: string;
  name: string;
  status: Status;
  method?: "text" | "ai";
  text: string;
  error?: string;
  seen: boolean; // the grader opened it: AI readings are meant to be compared with the original
};

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const PARALLEL = 3; // readings at once: AI reads take seconds each, local PDFs a moment
const MAX_FILES = 100;

const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError && typeof e.detail === "string" ? e.detail : fallback);

/** 20240001.pdf, 20240001_김민수.pdf, 김민수-20240001.jpg: the student id (and name) from the file name. */
export function parseFileName(fileName: string): { studentId: string; name: string } {
  const stem = fileName.replace(/\.[^.]+$/, "").trim();
  const idFirst = stem.match(/^(\d{5,12})(?:[\s_\-.]+(.+))?$/);
  if (idFirst) return { studentId: idFirst[1], name: (idFirst[2] ?? "").trim() };
  const idLast = stem.match(/^(.+?)[\s_\-.]+(\d{5,12})$/);
  if (idLast) return { studentId: idLast[2], name: idLast[1].trim() };
  return { studentId: "", name: "" };
}

const STATUS_TEXT: Record<Status, string> = {
  waiting: "대기",
  reading: "읽는 중…",
  read: "읽음",
  failed: "읽지 못함",
  saving: "저장 중…",
  saved: "저장됨",
};

/**
 * Many answers at once from PDFs and photos, one file per student. Every file is read as it is added,
 * a few at a time, and listed with where it stands; the grader checks each against its original and
 * saves the ones that are ready.
 */
export default function BulkRead({
  assignmentId,
  graded,
  existing,
  onClose,
  onGraded,
}: {
  assignmentId: number;
  graded: boolean; // grading has started: the new answers can be graded on their own right away
  existing: Set<string>; // student ids already uploaded to this question
  onClose: () => void;
  onGraded: (firstSubmissionId: number) => void; // opens the first new student on the grading tab
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const queue = useRef<Row[]>([]);
  const active = useRef(0);
  const urls = useRef<string[]>([]);
  const seq = useRef(0);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // a few readings at a time; each one that ends starts the next
  const pump = () => {
    while (active.current < PARALLEL && queue.current.length) {
      const row = queue.current.shift()!;
      active.current += 1;
      update(row.key, { status: "reading", error: undefined });
      const form = new FormData();
      form.append("file", row.file);
      api<{ text: string; method: "text" | "ai" }>(`/assignments/${assignmentId}/readings`, { method: "POST", body: form })
        .then((r) => update(row.key, { status: "read", text: r.text, method: r.method }))
        .catch((e) => update(row.key, { status: "failed", error: errorMessage(e, "읽지 못했습니다") }))
        .finally(() => {
          active.current -= 1;
          pump();
        });
    }
  };

  const add = (files: FileList | File[]) => {
    const picked = Array.from(files).filter((f) => ACCEPT.split(",").includes(f.type));
    const room = MAX_FILES - rows.length;
    if (picked.length > room) toast.error(`한 번에 ${MAX_FILES}개까지 올릴 수 있습니다`);
    const added = picked.slice(0, Math.max(room, 0)).map((file): Row => {
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      return { key: `f${seq.current++}`, file, url, ...parseFileName(file.name), status: "waiting", text: "", seen: false };
    });
    if (!added.length) return;
    setRows((rs) => [...rs, ...added]);
    setSelected((s) => s ?? added[0].key);
    queue.current.push(...added);
    pump();
  };

  const retry = (row: Row) => {
    update(row.key, { status: "waiting", error: undefined });
    queue.current.push(row);
    pump();
  };

  const select = (key: string) => {
    setSelected(key);
    update(key, { seen: true });
  };

  // what stops a read answer from being saved
  const ids = rows.filter((r) => r.status !== "saved").map((r) => r.studentId.trim());
  const problem = (r: Row): string | null => {
    if (r.status === "saved") return null;
    const id = r.studentId.trim();
    if (!id) return "학번을 넣으세요";
    if (existing.has(id)) return "이미 올린 학번입니다";
    if (ids.filter((x) => x === id).length > 1) return "같은 학번 파일이 둘 이상입니다";
    if (r.status === "read" && !r.text.trim()) return "읽은 글이 비어 있습니다";
    return null;
  };
  const ready = rows.filter((r) => r.status === "read" && !problem(r));

  const count = (pred: (r: Row) => boolean) => rows.filter(pred).length;
  const segments: Segment[] = [
    { n: count((r) => r.status === "saved"), label: "저장됨", className: "bg-emerald-500" },
    { n: ready.length, label: "읽음 · 저장할 수 있음", className: "bg-sky-300 dark:bg-sky-700" },
    { n: count((r) => r.status === "failed" || (r.status === "read" && !!problem(r))), label: "확인 필요", className: "bg-amber-400" },
    { n: count((r) => r.status === "waiting" || r.status === "reading" || r.status === "saving"), label: "읽는 중", className: "bg-muted-foreground/30" },
  ];
  const aiRead = rows.filter((r) => r.method === "ai" && r.status !== "saved");
  const busy = rows.some((r) => r.status === "waiting" || r.status === "reading");

  const save = async (gradeNow: boolean) => {
    setSaving(true);
    let saved = 0;
    let first: number | null = null;
    for (const r of ready) {
      update(r.key, { status: "saving" });
      try {
        const s = await api<SubmissionOut>(
          `/assignments/${assignmentId}/submissions`,
          json({ student_id: r.studentId.trim(), name: r.name.trim() || null, answer: r.text, source_filename: r.file.name }),
        );
        update(r.key, { status: "saved", error: undefined });
        saved += 1;
        first ??= s.id;
      } catch (e) {
        update(r.key, { status: "read", error: errorMessage(e, "저장하지 못했습니다") });
      }
    }
    for (const key of ["submissions", "assignment", "grading", "cells", "results"]) {
      queryClient.invalidateQueries({ queryKey: [key, assignmentId] });
    }
    if (first !== null && gradeNow) {
      try {
        const status = await api<GradingStatus>(`/assignments/${assignmentId}/grade?only_new=true`, { method: "POST" });
        queryClient.setQueryData(["grading", assignmentId], status);
        toast.success(`답안 ${saved}개를 저장하고 채점했습니다`);
        setSaving(false);
        onClose();
        onGraded(first);
        return;
      } catch (e) {
        toast.error(errorMessage(e, "저장했지만 채점하지 못했습니다"));
      }
    } else if (saved) toast.success(`답안 ${saved}개를 저장했습니다`);
    setSaving(false);
  };

  const close = () => {
    const unsaved = rows.filter((r) => r.status !== "saved").length;
    if (unsaved && !confirm(`저장하지 않은 파일이 ${unsaved}개 있습니다. 닫을까요?`)) return;
    onClose();
  };

  const current = rows.find((r) => r.key === selected) ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>여러 파일로 답안 추가</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              add(e.dataTransfer.files);
            }}
          >
            <input
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) add(e.target.files);
                e.target.value = "";
              }}
            />
            학생마다 한 파일씩, PDF나 답안 사진을 여러 개 고르거나 끌어다 놓으세요
            <span className="text-xs">
              파일 이름에서 학번과 이름을 읽습니다 (예: 20240001.pdf, 20240001_김민수.pdf). 글자가 든 PDF는 이 컴퓨터에서, 스캔본·사진은 AI가
              읽습니다.
            </span>
          </label>

          {rows.length > 0 && (
            <>
              <div className="flex flex-col gap-1.5">
                <SegmentBar segments={segments} />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <SegmentLegend segments={segments} />
                  <span className="ml-auto">파일 {rows.length}개</span>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[18rem_1fr]">
                {/* every file and where it stands */}
                <ul className="flex max-h-[60vh] flex-col overflow-y-auto rounded-lg border">
                  {rows.map((r) => {
                    const issue = r.status === "failed" ? r.error : r.status === "read" ? (problem(r) ?? r.error) : null;
                    return (
                      <li key={r.key}>
                        <button
                          type="button"
                          onClick={() => select(r.key)}
                          className={cn(
                            "flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40",
                            r.key === selected && "bg-primary/5",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <span className="font-medium tabular-nums">{r.studentId || "학번 없음"}</span>
                            {r.name && <span className="truncate">{r.name}</span>}
                            <span
                              className={cn(
                                "ml-auto shrink-0 text-xs",
                                r.status === "saved" && "text-emerald-700 dark:text-emerald-400",
                                (r.status === "failed" || issue) && "text-amber-700 dark:text-amber-400",
                                (r.status === "waiting" || r.status === "reading" || r.status === "saving") && "text-muted-foreground",
                              )}
                            >
                              {STATUS_TEXT[r.status]}
                              {r.status === "read" && (r.method === "ai" ? " · AI" : " · PDF 글")}
                            </span>
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{r.file.name}</span>
                          {issue ? (
                            <span className="text-xs text-amber-700 dark:text-amber-400">{issue}</span>
                          ) : (
                            r.status === "read" &&
                            r.method === "ai" &&
                            !r.seen && <span className="text-xs text-muted-foreground">원본과 비교 전</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {/* the selected file: the original beside what was read, to check and fix */}
                {current && (
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="w-36"
                        placeholder="학번"
                        value={current.studentId}
                        disabled={current.status === "saved"}
                        onChange={(e) => update(current.key, { studentId: e.target.value })}
                      />
                      <Input
                        className="w-36"
                        placeholder="이름 (선택)"
                        value={current.name}
                        disabled={current.status === "saved"}
                        onChange={(e) => update(current.key, { name: e.target.value })}
                      />
                      {current.status === "failed" && (
                        <Button size="sm" variant="outline" onClick={() => retry(current)}>
                          다시 읽기
                        </Button>
                      )}
                      {current.status !== "saved" && current.status !== "saving" && current.status !== "reading" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto text-muted-foreground"
                          onClick={() => {
                            setRows((rs) => rs.filter((r) => r.key !== current.key));
                            queue.current = queue.current.filter((r) => r.key !== current.key);
                            setSelected(null);
                          }}
                        >
                          목록에서 빼기
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-2 lg:grid-cols-2">
                      {current.file.type === "application/pdf" ? (
                        <object data={current.url} type="application/pdf" className="h-96 w-full rounded-md border" aria-label="원본 PDF" />
                      ) : (
                        // a local blob preview: next/image has nothing to optimize here
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={current.url} alt="원본 답안" className="max-h-96 w-full rounded-md border object-contain" />
                      )}
                      <div className="flex flex-col gap-1">
                        <Textarea
                          rows={14}
                          className="flex-1 font-[inherit] leading-7"
                          disabled={current.status === "saved" || current.status === "saving"}
                          placeholder={current.status === "reading" || current.status === "waiting" ? "읽는 중…" : "읽은 글이 여기에 나옵니다. 직접 입력해도 됩니다."}
                          value={current.text}
                          onChange={(e) => update(current.key, { text: e.target.value })}
                        />
                        {current.method === "ai" && current.status !== "saved" && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            AI가 읽은 글입니다. 원본과 비교해 잘못 읽은 곳을 고친 뒤 저장하세요. 맞춤법은 학생이 쓴 그대로 둡니다.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">
              {aiRead.length > 0
                ? `AI가 읽은 ${aiRead.length}개 중 ${aiRead.filter((r) => r.seen).length}개를 원본과 비교했습니다. `
                : ""}
              저장할 때 이름·학번 같은 식별 정보는 지운 뒤 AI에 보냅니다.
            </span>
            {!ready.length && !saving && rows.some((r) => r.status === "saved") ? (
              // everything that could be saved is: what is left needs fixing or can stay out
              <Button onClick={close}>닫기</Button>
            ) : (
              <Button variant={graded ? "outline" : "default"} disabled={!ready.length || saving} onClick={() => save(false)}>
                {saving ? "저장 중…" : `${ready.length}개 저장`}
              </Button>
            )}
            {graded && ready.length > 0 && (
              <Button disabled={!ready.length || saving || busy} onClick={() => save(true)}>
                {`${ready.length}개 저장하고 바로 채점`}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

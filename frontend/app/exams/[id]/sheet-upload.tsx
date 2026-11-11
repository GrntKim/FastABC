"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera } from "@/components/camera";
import { SegmentBar, SegmentLegend, type Segment } from "@/components/segment-bar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, json, type ExamColumn, type ExamResults, type SubmissionOut } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { parseFileName } from "@/lib/student";
import { cn } from "@/lib/utils";

type Reading = components["schemas"]["ExamReadingOut"];
type CsvResult = components["schemas"]["ExamCsvOut"];
type Mode = "file" | "camera" | "csv";
const MODES: Record<Mode, string> = { file: "답안지 파일", camera: "카메라로 찍기", csv: "CSV" };
type Answer = components["schemas"]["ExamAnswerOut"] & { saved?: boolean; error?: string };
type Status = "waiting" | "reading" | "read" | "failed" | "saving" | "saved";
type Row = {
  key: string;
  file: File;
  url: string;
  studentId: string;
  name: string;
  status: Status;
  method?: Reading["method"];
  rest: string; // text before the first question number: a header, or a sheet without numbers
  answers: Answer[];
  error?: string;
  seen: boolean;
};

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const PARALLEL = 3;
const MAX_FILES = 100;
const STATUS_TEXT: Record<Status, string> = {
  waiting: "대기",
  reading: "읽는 중…",
  read: "읽음",
  failed: "읽지 못함",
  saving: "저장 중…",
  saved: "저장됨",
};

const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError && typeof e.detail === "string" ? e.detail : fallback);

/** Who already has an answer in each question, from the exam results: student refs per question id. */
export function answeredBy(results: ExamResults): Map<number, Set<string>> {
  const by = new Map<number, Set<string>>();
  results.columns.forEach((c, i) => {
    if (c.kind !== "question") return;
    by.set(c.id, new Set(results.students.filter((s) => s.cells[i]?.submitted).map((s) => s.student_ref)));
  });
  return by;
}

/**
 * The one place answers come in, for the whole exam. Whole answer sheets (one file or camera shot per
 * student) are read and split by question number ("1번", "2번", …) as they are added; the grader checks
 * every question's answer beside the original, then the answers go to their questions. A CSV with a
 * column per question goes in the same way. Grading then starts on each question that got new answers.
 */
export default function SheetUpload({
  examId,
  questions,
  answered,
  onClose,
}: {
  examId: number;
  questions: ExamColumn[]; // the exam's questions, in order
  answered: Map<number, Set<string>>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("file");
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const queue = useRef<Row[]>([]);
  const active = useRef(0);
  const urls = useRef<string[]>([]);
  const seq = useRef(0);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const update = (key: string, patch: Partial<Row> | ((r: Row) => Partial<Row>)) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r)));

  const pump = () => {
    while (active.current < PARALLEL && queue.current.length) {
      const row = queue.current.shift()!;
      active.current += 1;
      update(row.key, { status: "reading", error: undefined });
      const form = new FormData();
      form.append("file", row.file);
      api<Reading>(`/exams/${examId}/readings`, { method: "POST", body: form })
        .then((r) => update(row.key, { status: "read", method: r.method, rest: r.rest, answers: r.answers }))
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
      return { key: `f${seq.current++}`, file, url, ...parseFileName(file.name), status: "waiting", rest: "", answers: [], seen: false };
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

  // why one question's answer of a sheet will not be saved, if it will not
  const answerSkip = (r: Row, a: Answer): string | null => {
    if (a.saved) return null;
    if (!a.text.trim()) return "답 없음";
    if (a.locked) return "성적 확정된 문항";
    if (answered.get(a.assignment_id)?.has(r.studentId.trim())) return "이미 올린 답안";
    return null;
  };
  // why a whole sheet cannot be saved
  const ids = rows.filter((r) => r.status !== "saved").map((r) => r.studentId.trim());
  const problem = (r: Row): string | null => {
    if (r.status !== "read") return null;
    const id = r.studentId.trim();
    if (!id) return "학번을 넣으세요";
    if (ids.filter((x) => x === id).length > 1) return "같은 학번 파일이 둘 이상입니다";
    if (r.answers.every((a) => !a.text.trim())) return "문항 번호(1번, 2번…)를 찾지 못했습니다";
    if (r.answers.every((a) => answerSkip(r, a))) return "저장할 답안이 없습니다";
    return null;
  };
  const ready = rows.filter((r) => r.status === "read" && !problem(r));
  const toSave = ready.flatMap((r) => r.answers.filter((a) => !answerSkip(r, a)).map((a) => ({ r, a })));

  const count = (pred: (r: Row) => boolean) => rows.filter(pred).length;
  const segments: Segment[] = [
    { n: count((r) => r.status === "saved"), label: "저장됨", className: "bg-emerald-500" },
    { n: ready.length, label: "읽음 · 저장할 수 있음", className: "bg-sky-300 dark:bg-sky-700" },
    { n: count((r) => r.status === "failed" || !!problem(r)), label: "확인 필요", className: "bg-amber-400" },
    { n: count((r) => ["waiting", "reading", "saving"].includes(r.status)), label: "읽는 중", className: "bg-muted-foreground/30" },
  ];
  const aiRead = rows.filter((r) => r.method === "ai" && r.status !== "saved");
  const busy = rows.some((r) => r.status === "waiting" || r.status === "reading");

  // each question that got answers: the first grading run, or only the new answers; then everything refreshes
  const finish = async (touched: Set<number>, gradeNow: boolean) => {
    if (gradeNow) {
      for (const q of questions.filter((c) => touched.has(c.id))) {
        try {
          await api(`/assignments/${q.id}/grade${q.stage === "setup" ? "" : "?only_new=true"}`, { method: "POST" });
        } catch (e) {
          toast.error(`${q.number}번: ${errorMessage(e, "채점을 시작하지 못했습니다")}`);
        }
      }
    }
    queryClient.invalidateQueries({ queryKey: ["exam", examId] });
    for (const id of touched) {
      for (const key of ["submissions", "assignment", "grading", "cells", "results"]) queryClient.invalidateQueries({ queryKey: [key, id] });
    }
    queryClient.invalidateQueries({ queryKey: ["courses"] });
  };

  const save = async (gradeNow: boolean) => {
    setSaving(true);
    const touched = new Set<number>();
    const opened: { assignmentId: number; submissionId: number }[] = [];
    let saved = 0;
    for (const r of ready) {
      update(r.key, { status: "saving" });
      const results: Answer[] = [];
      for (const a of r.answers) {
        if (answerSkip(r, a)) {
          results.push(a);
          continue;
        }
        try {
          const created = await api<SubmissionOut>(
            `/assignments/${a.assignment_id}/submissions`,
            json({ student_id: r.studentId.trim(), name: r.name.trim() || null, answer: a.text, source_filename: r.file.name }),
          );
          results.push({ ...a, saved: true, error: undefined });
          touched.add(a.assignment_id);
          opened.push({ assignmentId: a.assignment_id, submissionId: created.id });
          saved += 1;
        } catch (e) {
          results.push({ ...a, error: errorMessage(e, "저장하지 못했습니다") });
        }
      }
      const done = results.every((a) => a.saved || answerSkip(r, a));
      update(r.key, { status: done ? "saved" : "read", answers: results });
    }

    if (saved) await finish(touched, gradeNow);
    setSaving(false);
    if (!saved) return;
    toast.success(gradeNow ? `답안 ${saved}개를 문항별로 저장하고 채점을 시작했습니다` : `답안 ${saved}개를 문항별로 저장했습니다`);
    if (!gradeNow) return;
    onClose();
    // one student's sheet (a booth shot): straight to their first answer
    if (ready.length === 1) router.push(`/assignments/${opened[0].assignmentId}?student=${opened[0].submissionId}`);
  };

  const close = () => {
    const unsaved = rows.filter((r) => r.status !== "saved").length;
    if (unsaved && !confirm(`저장하지 않은 답안지가 ${unsaved}개 있습니다. 닫을까요?`)) return;
    onClose();
  };

  const current = rows.find((r) => r.key === selected) ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>답안 올리기</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-1">
            {(Object.keys(MODES) as Mode[]).map((m) => (
              <Button key={m} size="sm" variant={mode === m ? "secondary" : "ghost"} onClick={() => setMode(m)}>
                {MODES[m]}
              </Button>
            ))}
          </div>
          {mode === "csv" ? (
            <CsvPanel examId={examId} questions={questions} onUploaded={finish} onClose={onClose} />
          ) : (
            <>
              {mode === "camera" ? (
                <div className="flex flex-col gap-1.5 md:flex-row md:items-start md:gap-4">
                  <div className="w-full md:max-w-md">
                    <Camera onShot={(file) => add([file])} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    학생 한 명의 답안지를 찍을 때마다 아래 목록에 들어갑니다. AI가 읽고 {questions.map((q) => `${q.number}번`).join("·")}으로
                    나누면, 학번을 넣고 원본과 비교한 뒤 저장하세요. 여러 장이면 장마다 찍습니다.
                  </p>
                </div>
              ) : (
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
                  학생마다 시험 전체 답안지 한 파일씩, PDF나 사진을 여러 개 고르거나 끌어다 놓으세요
                  <span className="text-xs">
                    답안지의 &lsquo;1번&rsquo;, &lsquo;2번&rsquo;… 표시로 문항을 나눠 {questions.map((q) => `${q.number}번`).join("·")}에 넣습니다.
                    파일 이름에서 학번과 이름을 읽습니다 (예: 20240001_김민수.pdf).
                    {questions.length === 1 && " 문항이 하나뿐이라 번호 표시가 없어도 파일 전체를 답으로 넣습니다."}
                  </span>
                </label>
              )}

              {rows.length > 0 && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <SegmentBar segments={segments} />
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <SegmentLegend segments={segments} />
                      <span className="ml-auto">
                        답안지 {rows.length}개 · 저장할 답안 {toSave.length}개
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[19rem_1fr]">
                    {/* every sheet, and how its questions came out */}
                    <ul className="flex max-h-[60vh] flex-col overflow-y-auto rounded-lg border">
                      {rows.map((r) => {
                        const issue = r.status === "failed" ? r.error : problem(r);
                        return (
                          <li key={r.key}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelected(r.key);
                                update(r.key, { seen: true });
                              }}
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
                                    issue && "text-amber-700 dark:text-amber-400",
                                    ["waiting", "reading", "saving"].includes(r.status) && "text-muted-foreground",
                                  )}
                                >
                                  {STATUS_TEXT[r.status]}
                                  {r.status === "read" && (r.method === "ai" ? " · AI" : " · PDF 글")}
                                </span>
                              </span>
                              {r.answers.length > 0 && (
                                // one mark per question: found, missing, or not going in
                                <span className="flex flex-wrap gap-1 text-[0.7rem]">
                                  {r.answers.map((a) => {
                                    const skip = answerSkip(r, a);
                                    return (
                                      <span
                                        key={a.assignment_id}
                                        title={skip ?? (a.saved ? "저장됨" : "저장할 답안")}
                                        className={cn(
                                          "rounded px-1.5 py-0.5",
                                          a.saved
                                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                                            : skip === "답 없음"
                                              ? "bg-muted text-muted-foreground line-through"
                                              : skip
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                                : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
                                        )}
                                      >
                                        {a.number}번
                                      </span>
                                    );
                                  })}
                                </span>
                              )}
                              {issue && <span className="text-xs text-amber-700 dark:text-amber-400">{issue}</span>}
                              {!issue && r.status === "read" && r.method === "ai" && !r.seen && (
                                <span className="text-xs text-muted-foreground">원본과 비교 전</span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>

                    {/* the selected sheet: the original beside each question's answer */}
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
                          {!["saved", "saving", "reading"].includes(current.status) && (
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
                            <object data={current.url} type="application/pdf" className="h-[28rem] w-full rounded-md border" aria-label="원본 답안지" />
                          ) : (
                            // a local blob preview: next/image has nothing to optimize here
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={current.url} alt="원본 답안지" className="max-h-[28rem] w-full rounded-md border object-contain" />
                          )}
                          <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
                            {current.status === "waiting" || current.status === "reading" ? (
                              <p className="text-sm text-muted-foreground">읽는 중…</p>
                            ) : (
                              current.answers.map((a) => {
                                const skip = answerSkip(current, a);
                                return (
                                  <label key={a.assignment_id} className="flex flex-col gap-1 text-sm">
                                    <span className="flex items-center gap-2">
                                      <strong>{a.number}번</strong>
                                      <span className="truncate text-muted-foreground">{a.title}</span>
                                      {(a.error || (skip && skip !== "답 없음")) && (
                                        <span className="ml-auto text-xs text-amber-700 dark:text-amber-400">{a.error ?? skip}</span>
                                      )}
                                      {a.saved && <span className="ml-auto text-xs text-emerald-700 dark:text-emerald-400">저장됨</span>}
                                    </span>
                                    <Textarea
                                      rows={4}
                                      className="font-[inherit] leading-6"
                                      disabled={a.saved || current.status === "saving" || a.locked}
                                      placeholder="이 문항의 답을 찾지 못했습니다. 비워 두면 미제출로 남습니다."
                                      value={a.text}
                                      onChange={(e) =>
                                        update(current.key, (r) => ({
                                          answers: r.answers.map((x) => (x.assignment_id === a.assignment_id ? { ...x, text: e.target.value } : x)),
                                        }))
                                      }
                                    />
                                  </label>
                                );
                              })
                            )}
                            {current.rest && (
                              <p className="text-xs text-muted-foreground">
                                문항 밖 글 (저장하지 않음): {current.rest.length > 120 ? `${current.rest.slice(0, 120)}…` : current.rest}
                              </p>
                            )}
                            {current.method === "ai" && current.status === "read" && (
                              <p className="text-xs text-amber-700 dark:text-amber-400">
                                AI가 읽고 문항별로 나눈 글입니다. 원본과 비교해 잘못 읽거나 잘못 나눈 곳을 고친 뒤 저장하세요.
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
                  {aiRead.length > 0 && `AI가 읽은 ${aiRead.length}개 중 ${aiRead.filter((r) => r.seen).length}개를 원본과 비교했습니다. `}
                  저장할 때 이름·학번 같은 식별 정보는 지운 뒤 AI에 보냅니다.
                </span>
                {!toSave.length && !saving && rows.some((r) => r.status === "saved") ? (
                  <Button onClick={close}>닫기</Button>
                ) : (
                  <>
                    <Button variant="outline" disabled={!toSave.length || saving} onClick={() => save(false)}>
                      {saving ? "저장 중…" : `답안 ${toSave.length}개 저장`}
                    </Button>
                    <Button disabled={!toSave.length || saving || busy} onClick={() => save(true)}>
                      {`답안 ${toSave.length}개 저장하고 채점`}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A CSV for the whole exam: 학번, optional 이름, and a column per question. Blank cells, students who
 * already have an answer, and signed-off questions are left alone, so the same file can go in again.
 */
function CsvPanel({
  examId,
  questions,
  onUploaded,
  onClose,
}: {
  examId: number;
  questions: ExamColumn[];
  onUploaded: (touched: Set<number>, gradeNow: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CsvResult | null>(null);

  const upload = async (gradeNow: boolean) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file!);
      const r = await api<CsvResult>(`/exams/${examId}/submissions/csv`, { method: "POST", body: form });
      const touched = new Set(r.questions.filter((q) => q.created > 0).map((q) => q.assignment_id));
      await onUploaded(touched, gradeNow && touched.size > 0);
      setResult(r);
      const created = r.questions.reduce((sum, q) => sum + q.created, 0);
      if (created) {
        toast.success(gradeNow ? `답안 ${created}개를 문항별로 넣고 채점을 시작했습니다` : `답안 ${created}개를 문항별로 넣었습니다`);
        if (gradeNow) onClose();
      } else toast.error("새로 넣을 답안이 없습니다");
    } catch (e) {
      toast.error(errorMessage(e, "올리지 못했습니다"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        학생마다 한 줄: 학번, 이름(선택), 그리고 문항마다 한 열({questions.map((q) => `${q.number}번`).join(", ")}). 빈 칸은 미제출로
        두고, 이미 답안이 있는 학생과 성적을 확정한 문항은 건너뜁니다. UTF-8 또는 CP949.
      </p>
      <Input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      {result && (
        <p className="text-sm">
          {result.questions.map((q) => `${q.number}번 ${q.created}개`).join(" · ")}
          {result.skipped_existing > 0 && ` · 이미 있던 답안 ${result.skipped_existing}개 건너뜀`}
          {result.locked.length > 0 && ` · 성적 확정된 ${result.locked.map((n) => `${n}번`).join("·")} 건너뜀`}
          {result.ignored_columns.length > 0 && ` · 쓰지 않은 열: ${result.ignored_columns.join(", ")}`}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">저장할 때 이름·학번 같은 식별 정보는 지운 뒤 AI에 보냅니다.</span>
        <Button variant="outline" disabled={!file || busy} onClick={() => upload(false)}>
          {busy ? "올리는 중…" : "올리기"}
        </Button>
        <Button disabled={!file || busy} onClick={() => upload(true)}>
          올리고 채점
        </Button>
      </div>
    </div>
  );
}

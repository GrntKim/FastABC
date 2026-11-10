"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, json, type GradingStatus, type SubmissionOut } from "@/lib/api";
import { cn } from "@/lib/utils";

type Reading = { text: string; method: "text" | "ai" };
type Source = "file" | "camera";

const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError && typeof e.detail === "string" ? e.detail : fallback);

/**
 * One answer from paper or a document: a PDF, a photo, or a webcam shot. The text is read first and
 * shown beside the original; only what the grader checked is saved. When the question is already
 * being graded, "저장하고 바로 채점" grades this answer alone and opens it.
 */
export default function ReadAnswer({
  assignmentId,
  graded,
  onClose,
  onGraded,
}: {
  assignmentId: number;
  graded: boolean; // grading has started: a new answer can be graded on its own right away
  onClose: () => void;
  onGraded: (submissionId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<Source>("file");
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [original, setOriginal] = useState<{ file: File; url: string } | null>(null);
  const [text, setText] = useState("");
  const [method, setMethod] = useState<Reading["method"] | null>(null);

  useEffect(
    () => () => {
      if (original) URL.revokeObjectURL(original.url);
    },
    [original],
  );

  const read = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<Reading>(`/assignments/${assignmentId}/readings`, { method: "POST", body: form });
    },
    onSuccess: (r) => {
      setText(r.text);
      setMethod(r.method);
    },
    onError: (e) => toast.error(errorMessage(e, "읽지 못했습니다")),
  });
  const take = (file: File) => {
    setOriginal({ file, url: URL.createObjectURL(file) });
    setText("");
    setMethod(null);
    read.mutate(file);
  };

  const save = useMutation({
    mutationFn: async (gradeNow: boolean) => {
      const s = await api<SubmissionOut>(
        `/assignments/${assignmentId}/submissions`,
        json({ student_id: studentId.trim(), name: name.trim() || null, answer: text, source_filename: original?.file.name ?? null }),
      );
      if (gradeNow) {
        const status = await api<GradingStatus>(`/assignments/${assignmentId}/grade?only_new=true`, { method: "POST" });
        queryClient.setQueryData(["grading", assignmentId], status);
      }
      return { s, gradeNow };
    },
    onSuccess: ({ s, gradeNow }) => {
      for (const key of ["submissions", "assignment", "grading", "cells", "results"]) {
        queryClient.invalidateQueries({ queryKey: [key, assignmentId] });
      }
      toast.success(gradeNow ? "답안을 저장하고 채점했습니다" : "답안을 저장했습니다");
      onClose();
      if (gradeNow) onGraded(s.id);
    },
    onError: (e) => toast.error(errorMessage(e, "저장하지 못했습니다")),
  });

  const ready = studentId.trim() && text.trim() && !read.isPending;
  const isPdf = original?.file.type === "application/pdf";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>종이 답안·문서로 답안 추가</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-[10rem_10rem_1fr]">
            <Input placeholder="학번" value={studentId} onChange={(e) => setStudentId(e.target.value)} />
            <Input placeholder="이름 (선택)" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="flex gap-1 sm:justify-end">
              {(["file", "camera"] as const).map((s) => (
                <Button key={s} size="sm" variant={source === s ? "secondary" : "ghost"} onClick={() => setSource(s)}>
                  {s === "file" ? "PDF·사진 파일" : "카메라로 찍기"}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {/* left: where the answer comes from; right: what was read, to check and fix */}
            <div className="flex min-h-72 flex-col gap-2">
              {source === "camera" ? (
                <Camera onShot={take} busy={read.isPending} />
              ) : (
                <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-sm text-muted-foreground hover:bg-muted/40">
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && take(e.target.files[0])}
                  />
                  PDF나 답안 사진(PNG·JPEG)을 고르세요
                  <span className="text-xs">글자가 들어 있는 PDF는 이 컴퓨터에서 읽고, 스캔본·사진은 AI가 읽습니다</span>
                </label>
              )}
              {original &&
                (isPdf ? (
                  <object data={original.url} type="application/pdf" className="h-80 w-full rounded-md border" aria-label="원본 PDF" />
                ) : (
                  // a local blob preview: next/image has nothing to optimize here
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={original.url} alt="원본 답안" className="max-h-80 w-full rounded-md border object-contain" />
                ))}
            </div>

            <div className="flex flex-col gap-2">
              <Textarea
                rows={14}
                className="flex-1 font-[inherit] leading-7"
                placeholder={read.isPending ? "읽는 중… (사진은 5초 안팎)" : "읽은 글이 여기에 나옵니다. 직접 입력해도 됩니다."}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {method && (
                <p className={cn("text-xs", method === "ai" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                  {method === "ai"
                    ? "AI가 읽은 글입니다. 원본과 비교해 잘못 읽은 곳을 고친 뒤 저장하세요. 맞춤법은 학생이 쓴 그대로 둡니다."
                    : "PDF에 들어 있는 글을 그대로 가져왔습니다."}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">
              저장할 때 이름·학번 같은 식별 정보는 CSV 답안처럼 지운 뒤 AI에 보냅니다.
            </span>
            <Button variant={graded ? "outline" : "default"} disabled={!ready || save.isPending} onClick={() => save.mutate(false)}>
              저장
            </Button>
            {graded && (
              <Button disabled={!ready || save.isPending} onClick={() => save.mutate(true)}>
                {save.isPending ? "채점 중…" : "저장하고 바로 채점"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The webcam, with a frame to line the answer up in. Only what is inside the frame is sent:
 * the name box at the top of the sheet stays out of the picture.
 */
function Camera({ onShot, busy }: { onShot: (file: File) => void; busy: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError("카메라를 열지 못했습니다. 브라우저의 카메라 권한을 확인하세요."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // the guide frame covers the middle 90% x 70% of the picture
    const [w, h] = [v.videoWidth * 0.9, v.videoHeight * 0.7];
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(v, (v.videoWidth - w) / 2, (v.videoHeight - h) / 2, w, h, 0, 0, w, h);
    canvas.toBlob((blob) => blob && onShot(new File([blob], "camera.jpg", { type: "image/jpeg" })), "image/jpeg", 0.92);
  };

  if (error) return <p className="rounded-lg border p-4 text-sm text-destructive">{error}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={video} autoPlay playsInline muted className="block w-full" />
        <div className="pointer-events-none absolute inset-x-[5%] inset-y-[15%] rounded-md border-2 border-dashed border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
        <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          학생이 쓴 답만 틀 안에 맞추세요
        </span>
      </div>
      <Button onClick={shoot} disabled={busy}>
        {busy ? "읽는 중…" : "찍고 읽기"}
      </Button>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * The webcam, with a frame to line the answer sheet up in. Only what is inside the frame is sent:
 * the name box at the top of the sheet can stay out of the picture.
 */
export function Camera({ onShot, busy = false }: { onShot: (file: File) => void; busy?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const shots = useRef(0);
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
    shots.current += 1;
    const name = `카메라_${shots.current}.jpg`;
    canvas.toBlob((blob) => blob && onShot(new File([blob], name, { type: "image/jpeg" })), "image/jpeg", 0.92);
  };

  if (error) return <p className="rounded-lg border p-4 text-sm text-destructive">{error}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={video} autoPlay playsInline muted className="block w-full" />
        <div className="pointer-events-none absolute inset-x-[5%] inset-y-[15%] rounded-md border-2 border-dashed border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
        <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          학생이 쓴 답을 틀 안에 맞추세요
        </span>
      </div>
      <Button onClick={shoot} disabled={busy}>
        {busy ? "읽는 중…" : "찍고 읽기"}
      </Button>
    </div>
  );
}

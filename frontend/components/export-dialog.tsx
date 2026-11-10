"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { NameMode } from "@/lib/sheet";
import { cn } from "@/lib/utils";

type Format = "csv" | "record" | "notice";

const FORMATS: { value: Format; name: string; hint: string }[] = [
  { value: "csv", name: "CSV", hint: "LMS나 엑셀에 올릴 때. 학번·이름·점수를 그대로 담습니다." },
  { value: "record", name: "PDF 보관용", hint: "학번·이름 그대로, 확정자·시각·결과 해시를 함께 찍습니다. 학과 보관·제출용입니다." },
  { value: "notice", name: "PDF 공지용", hint: "학번 가운데를 가립니다(예: 2024****01). 게시판·LMS에 그대로 올릴 수 있습니다." },
];

const NAME_MODES: { value: NameMode; name: string }[] = [
  { value: "hide", name: "이름 빼기" },
  { value: "mask", name: "가운데만 가리기 (김*수)" },
];

/** One export button for every format: the CSV as before, or a grade list to save as PDF for keeping or posting. */
export function ExportButton({
  csvHref,
  printPath,
  variant = "outline",
  size,
}: {
  csvHref: string;
  printPath: string; // the print page; the format goes in its query
  variant?: "outline" | "default";
  size?: "sm";
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("record");
  const [names, setNames] = useState<NameMode>("hide");

  const go = () => {
    if (format === "csv") window.location.href = csvHref;
    else window.open(`${printPath}?kind=${format}${format === "notice" ? `&names=${names}` : ""}`, "_blank");
    setOpen(false);
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        내보내기
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>내보내기</DialogTitle>
            <DialogDescription>어디에 쓸지 고르세요. PDF는 새 탭의 인쇄 창에서 &lsquo;PDF로 저장&rsquo;으로 저장합니다.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2" role="radiogroup">
            {FORMATS.map((f) => (
              <label
                key={f.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40",
                  format === f.value && "border-primary bg-primary/5",
                )}
              >
                <input type="radio" name="format" className="mt-1" checked={format === f.value} onChange={() => setFormat(f.value)} />
                <span className="flex flex-col gap-1">
                  <strong>{f.name}</strong>
                  <span className="text-muted-foreground">{f.hint}</span>
                  {f.value === "notice" && format === "notice" && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {NAME_MODES.map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          className={buttonVariants({ size: "xs", variant: names === m.value ? "secondary" : "ghost" })}
                          onClick={(e) => {
                            e.preventDefault();
                            setNames(m.value);
                          }}
                        >
                          {m.name}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={go}>{format === "csv" ? "CSV 내려받기" : "PDF 만들기"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

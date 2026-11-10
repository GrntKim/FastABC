"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { CourseRef, FinalizationOut } from "@/lib/api";
import { termLabel } from "@/lib/progress";
import type { NameMode, SheetKind } from "@/lib/sheet";
import { formatPoints } from "@/lib/rubric";
import { maskId, maskName } from "@/lib/student";
import { useMe } from "@/lib/use-me";

export type SheetColumn = { title: string; max: number };
export type SheetRow = {
  ref: string;
  name: string | null;
  cells: (number | "missing" | null)[]; // null: not decided yet; "missing": no answer or score
  total: number | null; // null while anything is undecided
};
/** One sign-off behind the sheet: a question's current version, or where imported points came from. */
export type SheetRecord = { title: string; text: string; hash?: string };

export const signedAt = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** What a question's sign-off history says about the sheet: the version in force, or that there is none yet. */
export function signOffRecord(title: string, finalized: boolean, latest: FinalizationOut | undefined): SheetRecord {
  if (finalized && latest)
    return {
      title,
      text: `v${latest.version} 확정 · ${latest.finalized_by} · ${signedAt(latest.finalized_at)}${latest.late ? " · 마감 후 확정" : ""}`,
      hash: latest.snapshot_hash,
    };
  if (latest?.reopened_at) return { title, text: `확정 전 (v${latest.version} 개정 중: ${latest.reopen_reason})` };
  return { title, text: "확정 전" };
}

const cell = (v: number | "missing" | null) => (v === "missing" ? "미제출" : v === null ? "–" : formatPoints(v));

/**
 * A grade list laid out for A4, saved as PDF through the browser's print dialog (no PDF library:
 * the browser already sets Korean type well). The toolbar above the paper never prints.
 */
export function GradeSheet({
  kind,
  names,
  heading,
  course,
  columns,
  maxTotal,
  rows,
  finalized,
  records,
}: {
  kind: SheetKind;
  names: NameMode;
  heading: string;
  course: CourseRef;
  columns: SheetColumn[];
  maxTotal: number;
  rows: SheetRow[];
  finalized: boolean;
  records: SheetRecord[];
}) {
  const me = useMe();
  const notice = kind === "notice";
  const showName = !notice || names === "mask";
  const id = (r: SheetRow) => (notice ? maskId(r.ref) : r.ref);
  const name = (r: SheetRow) => (r.name ? (notice ? maskName(r.name) : r.name) : "-");

  // starred ids repeat more often than one would think: say so before it is posted
  const keys = rows.map((r) => (showName ? `${id(r)} ${name(r)}` : id(r)));
  const clashing = keys.filter((k) => keys.indexOf(k) !== keys.lastIndexOf(k)).length;

  const totals = rows.map((r) => r.total).filter((t): t is number => t !== null);
  const mean = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const kindLabel = notice ? "공지용" : "보관용";
  const printedAt = signedAt(new Date().toISOString());

  // the print dialog opens by itself once the Korean glyphs have loaded; the PDF takes the title as its file name
  const printed = useRef(false);
  useEffect(() => {
    document.title = `${course.name}_${heading}_${kindLabel}`.replace(/\s+/g, "_");
    if (printed.current) return;
    printed.current = true;
    document.fonts.ready.then(() => setTimeout(() => window.print(), 200));
  }, [course.name, heading, kindLabel]);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <style>{"@page { size: A4; margin: 14mm 12mm; } @media print { html, body { background: white !important; } }"}</style>

      <div className="flex w-full max-w-[210mm] flex-wrap items-center gap-2 text-sm print:hidden">
        <Button onClick={() => window.print()}>PDF로 저장</Button>
        <span className="text-muted-foreground">인쇄 창에서 대상을 &lsquo;PDF로 저장&rsquo;으로 고르세요.</span>
        {notice && clashing > 0 && (
          <p className="w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            가린 학번{showName && "과 이름"}이 겹치는 학생이 {clashing}명 있습니다.
            {names === "hide" ? " 이름 가운데 가리기를 함께 쓰면 구분하기 쉽습니다." : " 공지 전에 확인하세요."}
          </p>
        )}
      </div>

      <article className="w-full max-w-[210mm] bg-white p-[12mm] text-[10pt] text-neutral-900 shadow-sm ring-1 ring-neutral-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="mb-4 flex items-end gap-3 border-b-2 border-neutral-800 pb-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-[9pt] text-neutral-600">
              {course.department} · {termLabel(course.term)} · {course.name} ({course.section}분반)
            </p>
            <h1 className="text-[16pt] font-bold leading-tight">{heading} 성적</h1>
          </div>
          <span className="ml-auto rounded border border-neutral-500 px-2 py-0.5 text-[9pt]">{notice ? "성적 공지" : "성적표 (보관용)"}</span>
        </header>

        {!finalized && (
          <p className="mb-3 border border-neutral-800 px-3 py-1.5 text-[9pt] font-medium">
            성적 확정 전 자료입니다. 점수가 바뀔 수 있습니다.
          </p>
        )}

        <table className="w-full border-collapse tabular-nums [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-neutral-400 [&_th]:bg-neutral-100 [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium [&_th]:whitespace-nowrap">
          <thead>
            <tr>
              <th className="w-10">번호</th>
              <th>학번</th>
              {showName && <th>이름</th>}
              {columns.map((c) => (
                <th key={c.title} className="text-right">
                  {c.title}
                  <span className="block text-[8pt] font-normal text-neutral-600">{formatPoints(c.max)}점</span>
                </th>
              ))}
              <th className="text-right">
                총점
                <span className="block text-[8pt] font-normal text-neutral-600">{formatPoints(maxTotal)}점</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.ref} className="break-inside-avoid even:bg-neutral-50">
                <td className="text-center text-neutral-600">{i + 1}</td>
                <td>{id(r)}</td>
                {showName && <td>{name(r)}</td>}
                {r.cells.map((v, j) => (
                  <td key={j} className={v === "missing" || v === null ? "text-right text-neutral-500" : "text-right"}>
                    {cell(v)}
                  </td>
                ))}
                <td className="text-right font-semibold">{r.total === null ? <span className="font-normal text-neutral-500">채점 중</span> : formatPoints(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-2 text-[9pt] text-neutral-700">
          학생 {rows.length}명
          {mean !== null && ` · 평균 ${mean.toFixed(1)} · 최고 ${formatPoints(Math.max(...totals))} · 최저 ${formatPoints(Math.min(...totals))} (${formatPoints(maxTotal)}점 만점)`}
          {columns.length > 0 && " · 미제출은 0점으로 합산"}
        </p>

        <footer className="mt-6 flex flex-col gap-1 border-t border-neutral-300 pt-2 text-[8pt] text-neutral-600">
          {notice ? (
            <p>
              학번 가운데 자리{names === "mask" ? "와 이름 가운데 글자" : ""}를 가렸습니다{names === "hide" ? ". 이름은 싣지 않았습니다" : ""}. {printedAt} 기준.
            </p>
          ) : (
            <>
              <p className="font-medium text-neutral-800">확정 기록</p>
              <ul className="flex flex-col gap-0.5">
                {records.map((r) => (
                  <li key={r.title}>
                    {r.title}: {r.text}
                    {r.hash && <span className="block break-all font-mono text-[7pt]">결과 해시 {r.hash}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                출력 {printedAt}
                {me.data && ` · ${me.data.name}`} · FastABC. 결과 해시는 FastABC의 확정 기록과 대조할 수 있습니다.
              </p>
            </>
          )}
        </footer>
      </article>
    </div>
  );
}

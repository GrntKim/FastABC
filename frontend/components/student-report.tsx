"use client";

import { useQueries } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { components } from "@/lib/api-types";
import { api, type AssignmentOut, type CourseRef, type FinalizationOut, type RubricItemOut } from "@/lib/api";
import { signedAt } from "@/components/grade-sheet";
import { annotate } from "@/lib/highlight";
import { termLabel } from "@/lib/progress";
import { describePred, formatPoints, itemName, plain } from "@/lib/rubric";

export type StudentReport = components["schemas"]["StudentReport"];
export type AssignmentReport = components["schemas"]["AssignmentReport"];

/** One question on a student's page: signed off (with the answer, or none), or not signed off yet. */
export type ReportQuestion = {
  key: number;
  number: number | null;
  title: string;
  max: number;
  assignment?: AssignmentOut; // signed-off questions only
  finalization?: FinalizationOut;
  answer?: StudentReport | null; // null: the student wrote no answer
};
export type ReportPage = {
  ref: string;
  name: string | null;
  questions: ReportQuestion[];
  extras: { title: string; points: number | null; max: number }[]; // points imported from elsewhere
  total: number | null; // null when a question is not signed off yet
  maxTotal: number;
};

const itemMax = (item: RubricItemOut) =>
  item.kind === "deduction" ? (item.points ?? 0) : item.type === "noul" ? (item.points ?? 0) : Math.max(0, ...Object.values(item.points_map ?? {}));

/** What the item asks for, and for a level item the level the grader settled on. */
function criterion(item: RubricItemOut, points: number | null): string {
  if (item.type === "noul") return describePred(item, true) ?? plain(item.instructions);
  const level = Object.entries(item.points_map ?? {}).find(([, v]) => v === points)?.[0];
  const text = level === undefined ? undefined : describePred(item, item.type === "score" ? Number(level) : level);
  return text ? `${plain(item.instructions)} → ${text}` : plain(item.instructions);
}

const pointsText = (item: RubricItemOut, points: number | null) => {
  if (points === null) return "–";
  if (item.kind === "deduction") return points < 0 ? `−${formatPoints(-points)}` : "0";
  return `${formatPoints(points)} / ${formatPoints(itemMax(item))}`;
};

/**
 * Grading reports for students, one A4 page (or more) each, saved as PDF through the print dialog like the
 * grade sheets. A page holds what the grader signed off: every rubric item with its points and, where a
 * judge agreed with the grader, the answer's own words behind them. AI reasoning is never printed.
 */
export function ReportSheets({ course, heading, pages }: { course: CourseRef; heading: string; pages: ReportPage[] }) {
  const printedAt = signedAt(new Date().toISOString());
  const printed = useRef(false);
  useEffect(() => {
    document.title = `${course.name}_${heading}_근거표${pages.length === 1 ? `_${pages[0].ref}` : ""}`.replace(/\s+/g, "_");
    if (printed.current || pages.length === 0) return;
    printed.current = true;
    document.fonts.ready.then(() => setTimeout(() => window.print(), 200));
  }, [course.name, heading, pages]);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <style>{"@page { size: A4; margin: 14mm 12mm; } @media print { html, body { background: white !important; } }"}</style>
      <div className="flex w-full max-w-[210mm] flex-wrap items-center gap-2 text-sm print:hidden">
        <Button onClick={() => window.print()}>PDF로 저장</Button>
        <span className="text-muted-foreground">
          학생 {pages.length}명 · 학생마다 새 페이지에서 시작합니다. 인쇄 창에서 대상을 &lsquo;PDF로 저장&rsquo;으로 고르세요.
        </span>
      </div>
      {pages.length === 0 && <p className="text-muted-foreground">근거표를 만들 학생이 없습니다.</p>}
      {pages.map((page) => (
        <article
          key={page.ref}
          className="w-full max-w-[210mm] break-after-page bg-white p-[12mm] text-[9.5pt] leading-relaxed text-neutral-900 shadow-sm ring-1 ring-neutral-200 last:break-after-auto print:max-w-none print:p-0 print:shadow-none print:ring-0"
        >
          <header className="mb-4 flex items-end gap-3 border-b-2 border-neutral-800 pb-2">
            <div className="flex flex-col gap-0.5">
              <p className="text-[9pt] text-neutral-600">
                {course.department} · {termLabel(course.term)} · {course.name} ({course.section}분반)
              </p>
              <h1 className="text-[15pt] font-bold leading-tight">{heading} 채점 근거</h1>
              <p className="text-[10.5pt]">
                {page.ref} {page.name ?? ""}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[8pt] text-neutral-600">합계</p>
              <p className="text-[15pt] font-bold tabular-nums">
                {page.total === null ? "–" : formatPoints(page.total)}
                <span className="text-[10pt] font-normal text-neutral-600"> / {formatPoints(page.maxTotal)}</span>
              </p>
            </div>
          </header>

          {page.questions.map((q) => (
            <QuestionSection key={q.key} question={q} />
          ))}

          {page.extras.length > 0 && (
            <p className="mt-3 text-[9pt]">
              다른 곳에서 채점한 점수:{" "}
              {page.extras.map((x) => `${x.title} ${x.points === null ? "미제출" : formatPoints(x.points)} / ${formatPoints(x.max)}`).join(" · ")}
            </p>
          )}

          <footer className="mt-5 flex flex-col gap-1 border-t border-neutral-300 pt-2 text-[7.5pt] text-neutral-600">
            <p>
              점수는 채점자가 채점 기준의 항목마다 확인해 확정했습니다. &ldquo;답안에서&rdquo;는 그 점수의 근거가 된 답안 속 문장이며, 답안에
              같은 색으로 표시했습니다. 점수에 이의가 있으면 성적 이의신청 기간 안에 담당 교수에게 문의하세요.
            </p>
            {page.questions
              .filter((q) => q.finalization)
              .map((q) => (
                <p key={q.key}>
                  {q.number !== null ? `${q.number}번` : q.title}: v{q.finalization!.version} 확정 · {q.finalization!.finalized_by} ·{" "}
                  {signedAt(q.finalization!.finalized_at)}
                  <span className="block break-all font-mono text-[6.5pt]">결과 해시 {q.finalization!.snapshot_hash}</span>
                </p>
              ))}
            <p>출력 {printedAt} · FastABC</p>
          </footer>
        </article>
      ))}
    </div>
  );
}

function QuestionSection({ question: q }: { question: ReportQuestion }) {
  const name = `${q.number !== null ? `${q.number}번 ` : ""}${q.title}`;
  if (!q.assignment || !q.finalization)
    return (
      <section className="mb-4 break-inside-avoid">
        <h2 className="text-[11pt] font-bold">{name}</h2>
        <p className="text-neutral-600">아직 성적 확정 전이라 싣지 않았습니다.</p>
      </section>
    );
  const a = q.answer;
  const items = new Map(q.assignment.items.map((i) => [i.id, i]));
  const rows = (a?.items ?? []).map((r, i) => ({ ...r, item: items.get(r.rubric_item_id)!, n: i + 1 })).filter((r) => r.item);
  const marked = a ? annotate(a.answer, rows.filter((r) => r.quotes.length).map((r) => ({ id: r.n, quotes: r.quotes }))) : [];

  return (
    <section className="mb-5">
      <h2 className="flex items-baseline gap-2 border-b border-neutral-400 pb-0.5 text-[11pt] font-bold">
        {name}
        <span className="ml-auto text-[10pt] tabular-nums">
          {a ? (a.total === null ? "–" : formatPoints(a.total)) : "미제출"}
          <span className="font-normal text-neutral-600"> / {formatPoints(q.max)}</span>
        </span>
      </h2>
      <p className="mt-1.5 text-[8.5pt] text-neutral-700">
        <span className="font-medium">문제</span> {q.assignment.problem}
      </p>
      {!a ? (
        <p className="mt-1 text-neutral-600">이 문항에 낸 답안이 없어 0점입니다.</p>
      ) : (
        <>
          <div className="mt-1.5 whitespace-pre-wrap rounded border border-neutral-300 px-2.5 py-1.5 text-[9pt]">
            {marked.map((s, i) =>
              s.ids.length ? (
                <span key={i}>
                  <mark className="bg-amber-100 text-inherit">{s.text}</mark>
                  <sup className="text-[6.5pt] font-semibold text-amber-800">{s.ids.join(",")}</sup>
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </div>
          {a.off_topic && <p className="mt-1 font-medium">문제와 관련 없는 답안으로 보아 모든 항목을 0점으로 확정했습니다.</p>}
          <table className="mt-2 w-full border-collapse [&_td]:border [&_td]:border-neutral-300 [&_td]:px-1.5 [&_td]:py-1 [&_td]:align-top [&_th]:border [&_th]:border-neutral-400 [&_th]:bg-neutral-100 [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:text-left [&_th]:font-medium">
            <thead>
              <tr>
                <th className="w-5" />
                <th className="w-[24%]">항목</th>
                <th>채점 기준</th>
                <th className="w-14 text-right">점수</th>
                <th className="w-[30%]">답안에서</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rubric_item_id} className="break-inside-avoid">
                  <td className="text-center text-[8pt] text-neutral-600">{r.n}</td>
                  <td>
                    {itemName(r.item)}
                    {r.item.kind === "deduction" && <span className="ml-1 text-[7.5pt] text-neutral-600">(감점)</span>}
                  </td>
                  <td className="text-[8.5pt] text-neutral-700">{criterion(r.item, r.points ?? null)}</td>
                  <td className="text-right font-medium tabular-nums">{pointsText(r.item, r.points ?? null)}</td>
                  <td className="text-[8.5pt]">
                    {r.quotes.length ? (
                      r.quotes.map((quote) => <p key={quote}>&ldquo;{quote}&rdquo;</p>)
                    ) : r.by_grader && r.points ? (
                      <span className="text-neutral-600">채점자 판단</span>
                    ) : (
                      <span className="text-neutral-400">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/**
 * The signed-off reports of some questions, after quotes have been looked up for the answers no grader
 * opened (a few seconds per answer, once: later visits find them stored). Same order as `ids`.
 */
export function useReports(ids: number[], student: string | null) {
  const query = student ? `?student_ref=${encodeURIComponent(student)}` : "";
  const evidence = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["report-evidence", id, student],
      queryFn: () => api<{ requested: number }>(`/assignments/${id}/report/evidence${query}`, { method: "POST" }),
      staleTime: Infinity,
      retry: false,
    })),
  });
  const reports = useQueries({
    queries: ids.map((id, i) => ({
      queryKey: ["report", id, student],
      queryFn: () => api<AssignmentReport>(`/assignments/${id}/report${query}`),
      // a failed lookup only costs the quotes: the report is printed without them
      enabled: !evidence[i].isPending,
      retry: false,
    })),
  });
  return {
    looking: evidence.some((e) => e.isPending),
    reports: reports.every((r) => r.data) ? reports.map((r) => r.data!) : null,
    error: reports.find((r) => r.error)?.error ?? null,
  };
}

"use client";

import { useState } from "react";
import type { ExamResults } from "@/lib/api";
import { formatPoints } from "@/lib/rubric";
import { cn } from "@/lib/utils";

type Scope = "all" | "essay";

// bin widths a grader reads at a glance: "6~9점", not "6.4~9.6점"
const BIN_WIDTHS = [0.5, 1, 2, 3, 4, 5, 10, 15, 20, 25, 50, 100];
const MAX_BINS = 12;

/**
 * How the class did on the exam: highest, lowest, average and the spread of totals as a histogram. With points
 * imported from elsewhere (multiple choice), the grader picks the whole exam or the essay questions alone.
 * Only students whose total is settled count; the rest are named as left out.
 */
export function ExamStats({ results: r }: { results: ExamResults }) {
  const hasImported = r.columns.some((c) => c.kind === "imported");
  const [picked, setPicked] = useState<Scope>("all");
  const scope: Scope = hasImported ? picked : "all";

  const cols = r.columns.map((c, i) => ({ c, i })).filter(({ c }) => scope === "all" || c.kind === "question");
  const max = cols.reduce((sum, { c }) => sum + c.max_points, 0);
  // like the table's total: a missing answer is 0, an undecided one leaves the total open
  const totals = r.students.map((s) =>
    cols.some(({ i }) => s.cells[i]?.submitted && s.cells[i].points === null)
      ? null
      : cols.reduce((sum, { i }) => sum + (s.cells[i]?.points ?? 0), 0),
  );
  const done = totals.filter((t): t is number => t !== null).sort((a, b) => a - b);
  const waiting = totals.length - done.length;
  if (done.length === 0 || max <= 0) return null;

  const mean = done.reduce((a, b) => a + b, 0) / done.length;
  const mid = done.length >> 1;
  const median = done.length % 2 ? done[mid] : (done[mid - 1] + done[mid]) / 2;
  const sd = Math.sqrt(done.reduce((a, t) => a + (t - mean) ** 2, 0) / done.length);

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-semibold">분반 점수 분포</h2>
        <span className="text-xs text-muted-foreground">
          합계가 나온 {done.length}명{waiting > 0 && ` · 채점 중 ${waiting}명 제외`}
        </span>
        {hasImported && (
          <div className="ml-auto inline-flex rounded-lg bg-muted p-0.75 text-sm" role="group" aria-label="통계 범위">
            {(
              [
                ["all", "전체 (가져온 점수 포함)"],
                ["essay", "서술형만"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setPicked(value)}
                className={cn(
                  "rounded-md px-2.5 py-0.5 font-medium text-foreground/60 transition-colors hover:text-foreground",
                  scope === value && "bg-background text-foreground shadow-sm",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 md:grid-cols-2">
          <Stat label="평균" value={mean} max={max} big />
          <Stat label="중앙값" value={median} max={max} big />
          <Stat label="최고" value={done[done.length - 1]} max={max} />
          <Stat label="최저" value={done[0]} max={max} />
          <Stat label="표준편차" value={sd} />
        </dl>
        <Histogram totals={done} max={max} mean={mean} />
      </div>
    </section>
  );
}

function Stat({ label, value, max, big }: { label: string; value: number; max?: number; big?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", big ? "text-2xl leading-tight" : "text-lg leading-tight")}>
        {round(value)}
        {max !== undefined && <span className="text-xs font-normal text-muted-foreground"> / {formatPoints(max)}</span>}
      </dd>
    </div>
  );
}

const round = (v: number) => formatPoints(Math.round(v * 10) / 10);

/** How many students fell in each band of points, with the average marked; hover a bar for its band and count. */
function Histogram({ totals, max, mean }: { totals: number[]; max: number; mean: number }) {
  const width = BIN_WIDTHS.find((w) => max / w <= MAX_BINS) ?? Math.ceil(max / MAX_BINS);
  const bins = Math.max(1, Math.ceil(max / width));
  const span = bins * width; // the axis runs to a whole number of bands, a little past full marks at most
  const counts = Array.from({ length: bins }, () => 0);
  for (const t of totals) counts[Math.min(bins - 1, Math.floor(t / width))] += 1; // full marks join the top band
  const top = Math.max(...counts);
  const step = bins > 8 ? 2 : 1; // edge labels: every other one when the bands are narrow
  const pct = (v: number) => `${(v / span) * 100}%`;

  return (
    <figure className="flex flex-col gap-1" aria-label="학생 합계 점수 분포">
      <div className="relative mt-5 h-32">
        {/* recessive guides at the top count and half of it */}
        {[top, top / 2].map((g) => (
          <div key={g} className="absolute inset-x-0 border-t border-dashed border-foreground/10" style={{ bottom: `${(g / top) * 100}%` }}>
            {Number.isInteger(g) && <span className="absolute -top-2 left-0 bg-card pr-1 text-[10px] leading-none text-muted-foreground">{g}명</span>}
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-0.5 pl-7">
          {counts.map((n, i) => {
            const from = i * width;
            const to = Math.min(max, from + width);
            return (
              // the whole column answers hover, not only the bar, so a short bar is easy to point at
              <div key={i} className="group relative flex h-full flex-1 items-end">
                <div
                  className="w-full rounded-t-lg bg-primary/85 transition-colors group-hover:bg-primary"
                  style={{ height: n ? `${(n / top) * 100}%` : 0 }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 group-hover:block">
                  {formatPoints(from)}~{formatPoints(to)}점 · <span className="font-semibold">{n}명</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-7 right-0">
          <div className="absolute inset-y-0 border-l-2 border-foreground/70" style={{ left: pct(mean) }}>
            <span
              className={cn(
                "absolute bottom-full mb-1 whitespace-nowrap leading-none",
                // near either end the label leans inward so it stays inside the chart
                mean / span < 0.1 ? "translate-x-0" : mean / span > 0.9 ? "-translate-x-full" : "-translate-x-1/2",
              )}
            >
              <span className="text-[10px] font-medium text-foreground">평균 {round(mean)}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="relative ml-7 h-4 border-t border-foreground/20 text-[10px] text-muted-foreground tabular-nums">
        {Array.from({ length: bins + 1 }, (_, i) => i)
          // the last edge always shows, so a regular label just before it steps aside
          .filter((i) => i === bins || (i % step === 0 && bins - i >= step))
          .map((i) => (
            <span key={i} className="absolute top-0.5 -translate-x-1/2" style={{ left: pct(Math.min(max, i * width)) }}>
              {formatPoints(Math.min(max, i * width))}
            </span>
          ))}
      </div>
    </figure>
  );
}

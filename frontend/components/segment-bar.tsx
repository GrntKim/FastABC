import { cn } from "@/lib/utils";

export type Segment = { n: number; label: string; className: string };

/** Grading progress as one bar: confirmed, confirmable at once, and still to check. */
export const progressSegments = (done: number, quick: number, look: number): Segment[] => [
  { n: done, label: "확정", className: "bg-emerald-500" },
  { n: quick, label: "AI가 확신 · 한 번에 확정 가능", className: "bg-sky-300 dark:bg-sky-700" },
  { n: look, label: "확인 필요", className: "bg-amber-400" },
];

/** A stacked bar; widths are each segment's share of the sum. */
export function SegmentBar({ segments, className }: { segments: Segment[]; className?: string }) {
  const total = segments.reduce((sum, g) => sum + g.n, 0) || 1;
  return (
    <div
      className={cn("flex h-2.5 overflow-hidden rounded-full bg-muted", className)}
      role="img"
      aria-label={segments.map((g) => `${g.label} ${g.n}`).join(", ")}
    >
      {segments.map((g) => (
        <div
          key={g.label}
          className={cn("h-full transition-[width] duration-500", g.className)}
          style={{ width: `${(g.n / total) * 100}%` }}
          title={`${g.label} ${g.n}개`}
        />
      ))}
    </div>
  );
}

export function SegmentLegend({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((g) => (
        <span key={g.label} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", g.className)} />
          {g.label}
        </span>
      ))}
    </>
  );
}

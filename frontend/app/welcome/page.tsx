import { SegmentBar, SegmentLegend, progressSegments } from "@/components/segment-bar";
import { GRADING_STEPS, StepList } from "@/components/step-list";
import { cn } from "@/lib/utils";
import WelcomeActions from "./welcome-actions";

export const metadata = { title: "FastABC · 서술형 채점 보조" };

const PRINCIPLES = [
  {
    title: "점수는 채점자가 확정합니다",
    body: "AI는 추천 점수와 근거만 보여 주고 점수 칸을 미리 채우지 않습니다. 성적을 확정하면 확정한 사람과 시각이 기록에 남습니다.",
  },
  {
    title: "확인할 곳부터 보여 줍니다",
    body: "AI가 확신하지 못했거나 의견이 갈린 항목만 펼쳐 둡니다. 확신한 항목은 한 번에 확정하되, 일부는 무작위로 골라 다시 보게 합니다.",
  },
  {
    title: "근거는 답안 안에서",
    body: "확인할 항목마다 답안의 해당 문장을 짚어 줍니다. 누르면 답안지의 그 위치로 이동합니다.",
  },
];

// an illustration, not data: one student's items as the grading screen shows them
const SAMPLE = [
  { name: "해시 함수로 저장", result: "충족 · 2점", look: null },
  { name: "솔트 사용", result: "충족 · 2점", look: null },
  {
    name: "느린 해시 함수",
    look: { reason: "AI 의견이 갈림", quote: "bcrypt처럼 일부러 느리게 만든 함수를 쓰면" },
  },
  { name: "평문 저장의 위험", result: "미충족 · 0점", look: null },
];

/** The public front page: what FastABC does and why, before logging in. */
export default function WelcomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 break-keep p-4 py-12 sm:py-16">
      <section className="grid items-center gap-10 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-5">
          <h1 className="text-3xl font-bold leading-snug sm:text-4xl">서술형 채점, 봐야 할 곳부터.</h1>
          <p className="text-muted-foreground sm:text-lg">
            AI가 대학 서술형 답안을 채점 기준 항목별로 먼저 읽고, 애매한 곳만 골라 드립니다. 점수는 언제나 채점자가 확정합니다.
          </p>
          <WelcomeActions />
        </div>
        <SampleSheet />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {PRINCIPLES.map((p) => (
          <div key={p.title} className="flex flex-col gap-2">
            <h2 className="font-semibold">{p.title}</h2>
            <p className="text-sm text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">문항 하나는 이렇게 채점합니다</h2>
        <StepList steps={GRADING_STEPS} />
        <p className="text-xs text-muted-foreground">
          AI에는 학생 이름·학번을 지운 답안만 보냅니다. 원하면 이름을 가리고 채점할 수도 있습니다.
        </p>
      </section>
    </div>
  );
}

/** A small, static picture of the grading screen: most items settled by the AI, one left to look at. */
function SampleSheet() {
  const looks = SAMPLE.filter((s) => s.look).length;
  const segments = progressSegments(0, SAMPLE.length - looks, looks);
  return (
    <div aria-hidden className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">S007</span>
        <span className="text-xs text-muted-foreground">예시 화면</span>
      </div>
      <SegmentBar segments={segments} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <SegmentLegend segments={segments.slice(1)} />
      </div>
      <ul className="mt-1 flex flex-col divide-y rounded-lg border">
        {SAMPLE.map((s) => (
          <li key={s.name} className={cn("flex flex-col gap-2 px-3 py-2.5 text-sm", s.look && "bg-amber-50 dark:bg-amber-950/30")}>
            <div className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", s.look ? "bg-amber-400" : "bg-sky-300 dark:bg-sky-700")} />
              <span className={cn("flex-1", !s.look && "text-muted-foreground")}>{s.name}</span>
              {s.look ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                  {s.look.reason}
                </span>
              ) : (
                <span className="text-muted-foreground">{s.result}</span>
              )}
            </div>
            {s.look && (
              <p className="ml-4 border-l-2 border-amber-400 pl-2 text-xs text-muted-foreground">
                답안에서: “…{s.look.quote}…”
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

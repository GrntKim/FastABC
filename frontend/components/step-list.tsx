export type Step = { title: string; body: string };

/** The whole flow, for the welcome page and a grader's first visit. */
export const GRADING_STEPS: Step[] = [
  {
    title: "과목·시험과 문항 만들기",
    body: "시험 안에 문항을 만들고, 채점 기준을 평소 쓰던 문장 그대로 붙여 넣으면 AI가 채점 항목으로 나눕니다. 저장하기 전에 고칠 수 있습니다.",
  },
  {
    title: "답안 올리고 채점 시작",
    body: "학생들의 답안지(PDF·사진)나 CSV를 시험 단위로 올리면 문항별로 나눠 넣습니다. AI가 모든 답안의 항목을 판단해, 확신한 항목과 확인할 곳을 나눕니다.",
  },
  {
    title: "확인할 곳만 보고 확정",
    body: "확인이 필요한 항목부터 보여 줍니다. 나머지는 한 번에 확정하고, 다 끝나면 성적을 확정해 잠급니다.",
  },
];

/** Numbered steps side by side: the empty states' "what happens next". */
export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, i) => (
        <li key={step.title} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {i + 1}
          </span>
          <span className="font-medium">{step.title}</span>
          <span className="text-sm text-muted-foreground">{step.body}</span>
        </li>
      ))}
    </ol>
  );
}

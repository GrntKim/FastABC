export type Step = { title: string; body: string };

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

"use client";

import { type Student, studentFull, useHideNames } from "@/lib/student";
import { cn } from "@/lib/utils";

/** Who wrote this answer, as on the name box of an exam paper: the name and id, or only the label when hidden. */
export function StudentTag({ student, large = false }: { student: Student; large?: boolean }) {
  const [hidden] = useHideNames();
  const box = cn("border border-foreground/60 font-semibold", large ? "px-2 py-0.5 text-base" : "px-1.5 text-sm");
  if (hidden) return <span className={cn(box, "font-mono")}>{student.label}</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5" title={studentFull(student, false)}>
      {student.student_name && <span className={box}>{student.student_name}</span>}
      <span className={cn("tabular-nums", student.student_name ? "text-xs text-muted-foreground" : box)}>{student.student_ref}</span>
    </span>
  );
}

/** Grade blind: names and ids give way to S001 labels on every grading screen of this browser. */
export function HideNamesSwitch({ hidden, onChange }: { hidden: boolean; onChange: (hidden: boolean) => void }) {
  return (
    <label
      className="flex cursor-pointer items-center gap-1.5 px-2 text-xs text-muted-foreground"
      title="가리면 이름·학번 대신 S001 같은 라벨만 보입니다. AI에는 처음부터 이름·학번을 지운 답안만 갑니다."
    >
      <input type="checkbox" className="accent-primary" checked={hidden} onChange={(e) => onChange(e.target.checked)} />
      이름 가리고 채점
    </label>
  );
}

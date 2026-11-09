import { useSyncExternalStore } from "react";

/** What every row about a student carries: the anonymous label, the student id and, if uploaded, the name. */
export type Student = { label: string; student_ref: string; student_name?: string | null };

/** The name, else the student id; only the label while the grader hides names. */
export const studentName = (s: Student, hidden: boolean) => (hidden ? s.label : (s.student_name ?? s.student_ref));

/** "이름 · 학번" for tooltips and dialogs, or the label alone when hidden. */
export const studentFull = (s: Student, hidden: boolean) =>
  hidden ? s.label : s.student_name ? `${s.student_name} · ${s.student_ref}` : s.student_ref;

// A per-browser preference: every grading screen follows the same switch
const KEY = "fastabc.hideNames";
const listeners = new Set<() => void>();

function read() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function write(hidden: boolean) {
  try {
    localStorage.setItem(KEY, hidden ? "1" : "0");
  } catch {
    // storage blocked: the switch still works until the page reloads
  }
  memory = hidden;
  listeners.forEach((l) => l());
}

let memory: boolean | null = null;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether the grader grades blind (names and ids hidden behind S001 labels). Shown by default. */
export function useHideNames(): [boolean, (hidden: boolean) => void] {
  const hidden = useSyncExternalStore(
    subscribe,
    () => memory ?? (memory = read()),
    () => false,
  );
  return [hidden, write];
}

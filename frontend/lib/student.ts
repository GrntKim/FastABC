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

/**
 * A student id for a posted notice: the year and the last two digits stay, the middle is starred,
 * e.g. 2024123401 → 2024****01, 20260001 → 2026**01. Short ids keep only their ends.
 */
export function maskId(id: string): string {
  const chars = [...id];
  const [head, tail] = chars.length >= 7 ? [4, 2] : [1, 1];
  if (chars.length <= head + tail) return id;
  return chars.slice(0, head).join("") + "*".repeat(chars.length - head - tail) + chars.slice(-tail).join("");
}

/** A name with its middle starred: 김민수 → 김*수, 남궁민수 → 남**수, 이준 → 이*. */
export function maskName(name: string): string {
  const chars = [...name.trim()];
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return chars[0] + "*".repeat(chars.length - 2) + chars[chars.length - 1];
}

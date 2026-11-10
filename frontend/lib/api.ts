// Thin fetch wrapper for the FastAPI backend. Types come from `pnpm gen:api` (lib/api-types.ts).
import type { components } from "./api-types";

type Schemas = components["schemas"];
export type AssignmentIn = Schemas["AssignmentIn"];
export type AssignmentOut = Schemas["AssignmentOut"];
export type AssignmentSummary = Schemas["AssignmentSummary"];
export type RubricItemOut = Schemas["RubricItemOut"];
export type SubmissionOut = Schemas["SubmissionOut"];
export type GradingStatus = Schemas["GradingStatus"];
export type CellOut = Schemas["CellOut"];
export type GradeDecisionIn = Schemas["GradeDecisionIn"];
export type SubmissionResult = Schemas["SubmissionResult"];
export type CourseIn = Schemas["CourseIn"];
export type CourseRef = Schemas["CourseRef"];
export type CourseSummary = Schemas["CourseSummary"];
export type CourseOut = Schemas["CourseOut"];
export type ProgressOut = Schemas["ProgressOut"];
export type RubricItemIn = Schemas["RubricItemIn"];
export type RubricDraftOut = Schemas["RubricDraftOut"];
export type FinalizationOut = Schemas["FinalizationOut"];
export type UserOut = Schemas["UserOut"];
export type ExamRef = Schemas["ExamRef"];
export type ExamResults = Schemas["ExamResults"];
export type ExamColumn = Schemas["ExamColumn"];
export type TermScheduleOut = Schemas["TermScheduleOut"];

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(typeof detail === "string" ? detail : `API error ${status}`);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // JSON bodies only: a Content-Type on GET would trigger a CORS preflight for every request
  const headers = typeof init?.body === "string" ? { "Content-Type": "application/json" } : undefined;
  // the session cookie rides along: the API answers 401 without it
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...headers, ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.detail ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;

/** Pages anyone may open; a 401 there only means "logged out", not "go log in". Keep in step with proxy.ts. */
export const PUBLIC_PATHS = ["/login", "/welcome"];

/** Back to the login page, returning here afterwards. */
export function toLogin() {
  if (PUBLIC_PATHS.includes(window.location.pathname)) return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
}

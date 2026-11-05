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
  const headers = init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" };
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.detail ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

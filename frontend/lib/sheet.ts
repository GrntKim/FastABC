// The print page's query, read on the server before the client sheet renders.

/** record: everything as signed off, kept by the department. notice: ids starred, safe to post. */
export type SheetKind = "record" | "notice";
/** On a notice: names left out, or only their middle starred. */
export type NameMode = "hide" | "mask";

export const parseSheetQuery = (q: Record<string, string | string[] | undefined>) => ({
  kind: (q.kind === "notice" ? "notice" : "record") as SheetKind,
  names: (q.names === "mask" ? "mask" : "hide") as NameMode,
});

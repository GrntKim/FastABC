// Locate evidence quotes in the answer, ignoring whitespace like the backend's verify_evidence:
// PDF extraction loses whether a line break was a space, so "갱신하는" must match "갱신\n하는".

const STRIP = ".,\"'“”‘’";

function stripEnds(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && STRIP.includes(s[start])) start++;
  while (end > start && STRIP.includes(s[end - 1])) end--;
  return s.slice(start, end);
}

export type Segment = { text: string; marked: boolean };

export function highlight(text: string, quotes: string[]): Segment[] {
  // compact string of non-whitespace chars, with each char's index in the original text
  const positions: number[] = [];
  let compact = "";
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) {
      positions.push(i);
      compact += text[i];
    }
  }

  const ranges: [number, number][] = [];
  for (const quote of quotes) {
    const needle = stripEnds(quote.replace(/\s+/g, ""));
    if (!needle) continue;
    for (let at = compact.indexOf(needle); at !== -1; at = compact.indexOf(needle, at + 1)) {
      ranges.push([positions[at], positions[at + needle.length - 1] + 1]);
    }
  }
  if (ranges.length === 0) return [{ text, marked: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [ranges[0]];
  for (const [start, end] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), marked: false });
    segments.push({ text: text.slice(start, end), marked: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), marked: false });
  return segments;
}

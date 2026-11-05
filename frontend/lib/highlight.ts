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

/** [start, end) ranges in `text` where any quote occurs. */
function findRanges(text: string, quotes: string[]): [number, number][] {
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
  return ranges;
}

export type Segment = { text: string; marked: boolean };

export function highlight(text: string, quotes: string[]): Segment[] {
  return annotate(text, [{ id: 0, quotes }]).map((s) => ({ text: s.text, marked: s.ids.length > 0 }));
}

export type Annotated = { text: string; ids: number[] };

/** Split `text` into segments, each tagged with the ids whose quotes cover it (overlaps keep every id). */
export function annotate(text: string, groups: { id: number; quotes: string[] }[]): Annotated[] {
  const ranges = groups.flatMap((g) => findRanges(text, g.quotes).map(([s, e]) => ({ s, e, id: g.id })));
  if (ranges.length === 0) return [{ text, ids: [] }];

  const bounds = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.s, r.e])])].sort((a, b) => a - b);
  const segments: Annotated[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const [start, end] = [bounds[i], bounds[i + 1]];
    const ids = [...new Set(ranges.filter((r) => r.s <= start && end <= r.e).map((r) => r.id))];
    const last = segments[segments.length - 1];
    if (last && last.ids.join() === ids.join()) last.text += text.slice(start, end);
    else segments.push({ text: text.slice(start, end), ids });
  }
  return segments;
}

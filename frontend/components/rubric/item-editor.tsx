"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RubricItemIn } from "@/lib/api";
import { KIND_HINT } from "@/lib/rubric";

type Noul = { true: string; false: string };

const isNoulCriteria = (c: unknown): c is Noul => !!c && typeof c === "object" && "true" in c && "false" in c;

/** Switching type or kind reshapes criteria and points so the item stays valid. */
export function reshape(item: RubricItemIn, change: Partial<RubricItemIn>): RubricItemIn {
  const next = { ...item, ...change };
  if (next.kind === "deduction") next.type = "noul"; // deductions are yes/no only
  if (next.type === "score" && item.type !== "score") {
    return { ...next, criteria: ["", ""], points: null, points_map: { "0": 0, "1": 1 } };
  }
  if (next.type === "noul" && item.type !== "noul") {
    return { ...next, criteria: null, points: 1, points_map: null };
  }
  return next;
}

export default function ItemEditor({
  item,
  index,
  problems,
  onChange,
  onRemove,
}: {
  item: RubricItemIn;
  index: number;
  problems: string[];
  onChange: (item: RubricItemIn) => void;
  onRemove?: () => void;
}) {
  const gate = item.kind === "gate";
  const set = (change: Partial<RubricItemIn>) => onChange(reshape(item, change));
  const levels = item.type === "score" && Array.isArray(item.criteria) ? (item.criteria as string[]) : [];
  const levelPoints = item.points_map ?? {};
  const setLevels = (next: string[], points: number[]) =>
    onChange({
      ...item,
      criteria: next,
      points_map: Object.fromEntries(points.map((p, i) => [String(i), p])),
    });
  const pointsArray = levels.map((_, i) => levelPoints[String(i)] ?? i);
  const noul = isNoulCriteria(item.criteria) ? item.criteria : { true: "", false: "" };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-6 text-sm text-muted-foreground">{index + 1}</span>
        {gate ? (
          <Badge variant="outline" title={KIND_HINT.gate}>
            게이트
          </Badge>
        ) : (
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={item.kind}
            onChange={(e) => set({ kind: e.target.value as RubricItemIn["kind"] })}
            title={KIND_HINT[item.kind]}
          >
            <option value="credit">가점</option>
            <option value="deduction">감점</option>
          </select>
        )}
        {!gate && item.kind !== "deduction" && item.type !== "choice" && (
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={item.type}
            onChange={(e) => set({ type: e.target.value as RubricItemIn["type"] })}
          >
            <option value="noul">예/아니오</option>
            <option value="score">수준</option>
          </select>
        )}
        <Input
          className="h-8 max-w-56"
          placeholder="표시 이름 (예: 연쇄법칙 언급)"
          value={item.label ?? ""}
          onChange={(e) => onChange({ ...item, label: e.target.value || null })}
        />
        <Input
          className="h-8 max-w-56 font-mono text-xs"
          placeholder="key (영문 snake_case)"
          value={item.key}
          disabled={gate}
          onChange={(e) => onChange({ ...item, key: e.target.value })}
        />
        {item.type === "noul" && !gate && (
          <label className="flex items-center gap-1 text-sm">
            {item.kind === "deduction" ? "감점" : "배점"}
            <Input
              type="number"
              min={0}
              step={0.5}
              className="h-8 w-20"
              value={item.points ?? ""}
              onChange={(e) => onChange({ ...item, points: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
        )}
        {onRemove && (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={onRemove}>
            삭제
          </Button>
        )}
      </div>

      <Textarea
        rows={2}
        placeholder={item.type === "score" ? "`answer`의 …은(는) 얼마나 …한가?" : "`answer`가 …한다."}
        value={item.instructions}
        onChange={(e) => onChange({ ...item, instructions: e.target.value })}
      />

      {item.type === "noul" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {(["true", "false"] as const).map((side) => (
            <Input
              key={side}
              className="h-8 text-sm"
              placeholder={side === "true" ? "'예'로 볼 기준 (선택)" : "'아니오'로 볼 기준 (선택)"}
              value={noul[side]}
              onChange={(e) => {
                const next = { ...noul, [side]: e.target.value };
                onChange({ ...item, criteria: next.true || next.false ? next : null });
              }}
            />
          ))}
        </div>
      )}

      {item.type === "score" && (
        <div className="flex flex-col gap-1">
          {levels.map((desc, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 text-xs text-muted-foreground">수준 {i}</span>
              <Input
                className="h-8 text-sm"
                placeholder="이 수준의 설명"
                value={desc}
                onChange={(e) => setLevels(levels.map((l, j) => (j === i ? e.target.value : l)), pointsArray)}
              />
              <Input
                type="number"
                min={0}
                step={0.5}
                className="h-8 w-20"
                value={pointsArray[i]}
                onChange={(e) => setLevels(levels, pointsArray.map((p, j) => (j === i ? Number(e.target.value) : p)))}
                title="이 수준의 점수"
              />
              <Button
                size="xs"
                variant="ghost"
                disabled={levels.length <= 2}
                onClick={() => setLevels(levels.filter((_, j) => j !== i), pointsArray.filter((_, j) => j !== i))}
              >
                ×
              </Button>
            </div>
          ))}
          {levels.length < 10 && (
            <Button
              size="xs"
              variant="ghost"
              className="self-start"
              onClick={() => setLevels([...levels, ""], [...pointsArray, levels.length])}
            >
              + 수준 추가
            </Button>
          )}
        </div>
      )}

      {item.type === "choice" && (
        <p className="text-xs text-muted-foreground">선택형 항목은 아래 &lsquo;JSON으로 편집&rsquo;에서 수정하세요.</p>
      )}

      {problems.map((p) => (
        <p key={p} className="text-xs text-destructive">
          {p}
        </p>
      ))}
    </div>
  );
}

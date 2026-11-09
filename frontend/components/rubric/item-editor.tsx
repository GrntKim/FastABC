"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RubricItemIn } from "@/lib/api";
import { fromPlain, KIND_HINT, plain } from "@/lib/rubric";

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
  const deduction = item.kind === "deduction";

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-6 text-sm text-muted-foreground">{index + 1}</span>
        <Input
          className="h-8 min-w-48 flex-1 font-medium"
          placeholder="항목 이름 (예: 공격 예시 제시)"
          value={item.label ?? ""}
          onChange={(e) => onChange({ ...item, label: e.target.value || null })}
        />
        <select
          className="h-8 rounded-md border bg-card px-2 text-sm"
          value={item.kind}
          onChange={(e) => set({ kind: e.target.value as RubricItemIn["kind"] })}
          title={KIND_HINT[item.kind]}
        >
          <option value="credit">가점</option>
          <option value="deduction">감점</option>
        </select>
        {!deduction && item.type !== "choice" && (
          <select
            className="h-8 rounded-md border bg-card px-2 text-sm"
            value={item.type}
            onChange={(e) => set({ type: e.target.value as RubricItemIn["type"] })}
            title="충족 여부: 했는지 안 했는지만 봅니다. 수준별: 정도에 따라 점수를 나눕니다."
          >
            <option value="noul">충족 여부</option>
            <option value="score">수준별</option>
          </select>
        )}
        {item.type === "noul" && (
          <label className="flex items-center gap-1 text-sm">
            {deduction ? "감점" : "배점"}
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
          <Button size="xs" variant="ghost" onClick={onRemove}>
            삭제
          </Button>
        )}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">AI가 확인할 내용</span>
        <Textarea
          rows={2}
          placeholder={item.type === "score" ? "답안의 …은(는) 얼마나 …한가?" : deduction ? "답안이 …라고 잘못 설명한다." : "답안이 …을 설명한다."}
          value={plain(item.instructions)}
          onChange={(e) => onChange({ ...item, instructions: fromPlain(e.target.value) })}
        />
      </label>

      {item.type === "noul" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {(["true", "false"] as const).map((side) => (
            <Input
              key={side}
              className="h-8 text-sm"
              placeholder={
                side === "true"
                  ? deduction
                    ? "감점할 경우 (선택)"
                    : "충족으로 볼 경우 (선택)"
                  : deduction
                    ? "감점하지 않을 경우 (선택)"
                    : "미충족으로 볼 경우 (선택)"
              }
              value={plain(noul[side])}
              onChange={(e) => {
                const next = { ...noul, [side]: fromPlain(e.target.value) };
                onChange({ ...item, criteria: next.true || next.false ? next : null });
              }}
            />
          ))}
        </div>
      )}

      {item.type === "score" && (
        <div className="flex flex-col gap-1">
          {/* measured: level items were the least accurate kind in the evaluation set */}
          <p className="text-xs text-amber-700 dark:text-amber-400">
            수준별 항목은 AI가 판단하기 더 어렵습니다. 수준을 가르는 기준을 &lsquo;충족 여부&rsquo; 항목 여러 개로 나누면 추천이 더
            정확해집니다.
          </p>
          {levels.map((desc, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 text-xs text-muted-foreground">수준 {i}</span>
              <Input
                className="h-8 text-sm"
                placeholder="이 수준에 해당하는 답안"
                value={plain(desc)}
                onChange={(e) => setLevels(levels.map((l, j) => (j === i ? fromPlain(e.target.value) : l)), pointsArray)}
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
        <p className="text-xs text-muted-foreground">선택형 항목은 아래 &lsquo;고급: JSON으로 편집&rsquo;에서 수정하세요.</p>
      )}

      {problems.map((p) => (
        <p key={p} className="text-xs text-destructive">
          {p}
        </p>
      ))}
    </div>
  );
}

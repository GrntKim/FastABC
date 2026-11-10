import { cn } from "@/lib/utils";

/**
 * A small "?" that explains on hover or focus, for reasons that would crowd the screen if always shown.
 * A span, not a button: it sits inside clickable rows.
 */
export function HelpTip({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("group/help relative inline-flex shrink-0", className)}>
      <span
        tabIndex={0}
        aria-label={text}
        className="flex size-4 cursor-help items-center justify-center rounded-full border text-[0.65rem] leading-none text-muted-foreground outline-none hover:border-foreground/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        ?
      </span>
      <span
        role="tooltip"
        className="invisible absolute top-full left-1/2 z-30 mt-1.5 w-72 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-left text-xs leading-5 font-normal whitespace-normal text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/help:visible group-hover/help:opacity-100 group-focus-within/help:visible group-focus-within/help:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

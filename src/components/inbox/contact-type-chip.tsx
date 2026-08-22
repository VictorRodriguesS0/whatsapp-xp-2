import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

const HEX_COLOR = /^#[0-9A-F]{6}$/i;

export function ContactTypeChip({
  color,
  name,
  compact = false,
}: {
  color: string;
  name: string;
  compact?: boolean;
}) {
  const style: CSSProperties | undefined = HEX_COLOR.test(color)
    ? { borderColor: color }
    : undefined;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-md border bg-[var(--canvas)] font-semibold text-[var(--text)]",
        compact ? "px-1.5 py-0.5 text-[10px] leading-none" : "px-2 py-1 text-xs",
      )}
      style={style}
      title={name}
    >
      {name}
    </span>
  );
}

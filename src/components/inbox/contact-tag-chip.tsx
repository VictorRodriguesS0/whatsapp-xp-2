import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

type ContactTagChipProps = {
  color: string;
  name: string;
  compact?: boolean;
};

const HEX_COLOR = /^#[0-9A-F]{6}$/i;

function safeBorderStyle(color: string): CSSProperties | undefined {
  return HEX_COLOR.test(color) ? { borderColor: color } : undefined;
}

export function ContactTagChip({ color, name, compact = false }: ContactTagChipProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center whitespace-normal break-words rounded-full border bg-[var(--panel)] font-medium text-[var(--text)]",
        compact ? "px-1.5 py-0.5 text-[10px] leading-none" : "px-2 py-1 text-xs",
      )}
      style={safeBorderStyle(color)}
      title={name}
    >
      {name}
    </span>
  );
}

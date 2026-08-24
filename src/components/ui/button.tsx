import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "icon" | "small";
};

export function Button({
  asChild,
  className,
  variant = "primary",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:pointer-events-none disabled:opacity-55",
        variant === "primary" && "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]",
        variant === "secondary" && "border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text)] hover:bg-[var(--surface)]",
        variant === "ghost" && "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]",
        variant === "danger" && "bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:bg-[var(--destructive-hover)]",
        size === "icon" && "w-11 px-0",
        size === "small" && "px-3 text-xs",
        className,
      )}
      type={asChild ? undefined : type}
      {...props}
    />
  );
}

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
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)] disabled:pointer-events-none disabled:opacity-55",
        variant === "primary" && "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
        variant === "secondary" && "border border-[var(--border)] bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--canvas)]",
        variant === "ghost" && "text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--text)]",
        variant === "danger" && "bg-[var(--danger)] text-white hover:bg-[var(--danger-hover)]",
        size === "icon" && "w-11 px-0",
        size === "small" && "px-3 text-xs",
        className,
      )}
      type={asChild ? undefined : type}
      {...props}
    />
  );
}

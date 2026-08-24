import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex min-w-5 items-center justify-center rounded-lg bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-bold leading-none text-white", className)} {...props} />;
}

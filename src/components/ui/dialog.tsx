"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/25 data-[state=closed]:animate-none" />
      <DialogPrimitive.Content
        className={cn(
          "xp-dialog-content fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto rounded-l-xl border-l border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-[-8px_0_24px_rgba(17,24,39,0.18)] outline-none",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close aria-label="Fechar" className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-xl text-[var(--muted)] outline-none hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
          <X aria-hidden="true" className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

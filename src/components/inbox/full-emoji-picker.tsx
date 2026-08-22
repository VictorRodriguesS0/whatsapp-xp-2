"use client";

import { EmojiPicker } from "frimousse";

export function FullEmojiPicker({ onSelect }: { onSelect(emoji: string): void }) {
  return (
    <EmojiPicker.Root
      className="flex h-[22rem] w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-[var(--panel)]"
      columns={8}
      locale="pt"
      onEmojiSelect={({ emoji }) => onSelect(emoji)}
    >
      <div className="border-b border-[var(--border)] p-2">
        <EmojiPicker.Search
          aria-label="Buscar emoji"
          className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          placeholder="Buscar emoji"
          type="search"
        />
      </div>
      <EmojiPicker.Viewport className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        <EmojiPicker.Loading className="flex h-full items-center justify-center text-sm text-[var(--muted)]">Carregando emojis…</EmojiPicker.Loading>
        <EmojiPicker.Empty className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--muted)]">Nenhum emoji encontrado.</EmojiPicker.Empty>
        <EmojiPicker.List
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div {...props} className="sticky top-0 z-10 bg-[var(--panel)] px-2 py-1.5 text-xs font-semibold text-[var(--muted)]">
                {category.label}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button
                {...props}
                aria-label={emoji.label}
                className="flex size-10 items-center justify-center rounded-lg text-2xl outline-none hover:bg-[var(--canvas)] focus-visible:bg-[var(--canvas)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                type="button"
              >
                {emoji.emoji}
              </button>
            ),
            Row: ({ children, ...props }) => <div {...props} className="flex justify-center">{children}</div>,
          }}
        />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  );
}

"use client";

export type QuickReplyOption = { id: string; shortcut: string; message: string };

export function QuickReplyMenu({ items, activeIndex, onSelect }: {
  items: QuickReplyOption[];
  activeIndex: number;
  onSelect: (item: QuickReplyOption) => void;
}) {
  return (
    <div className="message-composer__quick-reply-menu mb-2 max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 shadow-[0_12px_32px_rgba(32,37,34,0.14)]" data-state="open" role="listbox" aria-label="Respostas rápidas">
      {items.map((item, index) => (
        <button
          aria-selected={index === activeIndex}
          className={`message-composer__quick-reply block min-h-11 w-full rounded-md px-3 py-2 text-left outline-none ${index === activeIndex ? "bg-[var(--selected)]" : "hover:bg-[var(--canvas)]"}`}
          id={`quick-reply-${item.id}`}
          key={item.id}
          onClick={() => onSelect(item)}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          type="button"
        >
          <span className="block text-sm font-bold text-[var(--accent)]">/{item.shortcut}</span>
          <span className="message-composer__quick-reply-message mt-0.5 block break-words text-sm text-[var(--muted)]">{item.message}</span>
        </button>
      ))}
    </div>
  );
}

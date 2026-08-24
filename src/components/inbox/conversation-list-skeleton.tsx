const SKELETON_ROWS = 6;

export function ConversationListSkeleton() {
  return (
    <div aria-live="polite" className="p-4" role="status">
      <span className="sr-only">Carregando conversas</span>
      <div aria-hidden="true" className="space-y-4">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div className="flex items-center gap-3" data-testid="conversation-list-skeleton-row" key={index}>
            <div className="size-11 shrink-0 animate-pulse rounded-full bg-[var(--surface)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/5 animate-pulse rounded bg-[var(--surface)]" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-[var(--surface)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

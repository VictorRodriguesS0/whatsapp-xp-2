import { cn } from "@/lib/utils";

type AppBrandProps = {
  compact?: boolean;
  href?: string;
  label?: string;
};

export function AppBrand({ compact = false, href, label = "XP Eletrônicos" }: AppBrandProps) {
  const content = (
    <>
      {/* Local asset with fixed dimensions; Next image configuration is intentionally unnecessary. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="Símbolo XP" height={28} src="/brand/xp-symbol.png" width={28} />
      {compact ? <span className="sr-only">{label}</span> : <span className="text-sm font-bold tracking-tight">{label}</span>}
    </>
  );
  const className = cn(
    "inline-flex min-h-11 items-center gap-2 rounded-xl text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
    compact && "justify-center",
  );

  return href ? <a aria-label={label} className={className} href={href}>{content}</a> : <div aria-label={label} className={className}>{content}</div>;
}

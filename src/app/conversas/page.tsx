import { redirect } from "next/navigation";

import { InboxShell } from "@/components/inbox/inbox-shell";
import { getCurrentUser } from "@/modules/auth/session";
import { getCatalogService } from "@/modules/catalog/factory";
import { getMetaHealthSummary } from "@/modules/meta-health/service";

export default async function ConversationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [initialMetaHealthSummary, initialCatalogReady] = await Promise.all([
    user.role === "ADMIN" ? getMetaHealthSummary(user).catch(() => null) : null,
    getCatalogService().getReadiness(user).catch(() => false),
  ]);
  return (
    <InboxShell
      initialCatalogReady={initialCatalogReady}
      initialMetaHealthSummary={initialMetaHealthSummary}
      initialUser={user}
    />
  );
}

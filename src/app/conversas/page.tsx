import { redirect } from "next/navigation";

import { InboxShell } from "@/components/inbox/inbox-shell";
import { getCurrentUser } from "@/modules/auth/session";
import { getMetaHealthSummary } from "@/modules/meta-health/service";

export default async function ConversationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const initialMetaHealthSummary = user.role === "ADMIN"
    ? await getMetaHealthSummary(user).catch(() => null)
    : null;
  return <InboxShell initialMetaHealthSummary={initialMetaHealthSummary} initialUser={user} />;
}

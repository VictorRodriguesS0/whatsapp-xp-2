import { redirect } from "next/navigation";

import { InboxShell } from "@/components/inbox/inbox-shell";
import { getCurrentUser } from "@/modules/auth/session";

export default async function ConversationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <InboxShell initialUser={user} />;
}

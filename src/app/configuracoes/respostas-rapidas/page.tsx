import { redirect } from "next/navigation";

import { QuickRepliesScreen } from "@/components/settings/quick-replies-screen";
import { getCurrentUser } from "@/modules/auth/session";
import { listQuickReplies } from "@/modules/quick-replies/service";

export default async function QuickRepliesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const quickReplies = await listQuickReplies({ activeOnly: false });
  return <QuickRepliesScreen initialQuickReplies={quickReplies} />;
}

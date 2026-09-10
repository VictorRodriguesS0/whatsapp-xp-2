import { redirect } from "next/navigation";

import { MetaHealthScreen } from "@/components/meta-health/meta-health-screen";
import { getMetaConnectionPublicConfig } from "@/modules/meta-connection/config";
import { getCurrentUser } from "@/modules/auth/session";
import { getMetaHealthSummary, listMetaHealthAlerts } from "@/modules/meta-health/service";

export default async function MetaHealthPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/conversas");
  const [initialSummary, initialAlerts] = await Promise.all([
    getMetaHealthSummary(user),
    listMetaHealthAlerts(user, { limit: 30 }),
  ]);
  return <MetaHealthScreen connectionConfig={getMetaConnectionPublicConfig()} initialAlerts={initialAlerts} initialSummary={initialSummary} />;
}

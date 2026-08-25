import { redirect } from "next/navigation";

import { CatalogSettingsScreen } from "@/components/catalog/catalog-settings-screen";
import { getCurrentUser } from "@/modules/auth/session";
import { getCatalogService } from "@/modules/catalog/factory";

export default async function CatalogSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/conversas");
  const initialStatus = await getCatalogService().getStatus(user);
  return <CatalogSettingsScreen initialStatus={initialStatus} />;
}

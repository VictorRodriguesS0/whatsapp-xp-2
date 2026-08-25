import { redirect } from "next/navigation";

import { WhatsAppPolicyScreen } from "@/components/settings/whatsapp-policy-screen";
import { getCurrentUser } from "@/modules/auth/session";
import { getWhatsAppPolicySettings } from "@/modules/templates/service";

export default async function WhatsAppSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/conversas");

  const settings = await getWhatsAppPolicySettings(user);
  return <WhatsAppPolicyScreen initialSettings={settings} />;
}

import { redirect } from "next/navigation";

import { ContactClassificationScreen } from "@/components/settings/contact-classification-screen";
import { getCurrentUser } from "@/modules/auth/session";
import { listContactTags, listContactTypes } from "@/modules/contacts/service";

export default async function ContactClassificationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/conversas");

  const [contactTypes, contactTags] = await Promise.all([
    listContactTypes(user),
    listContactTags(user),
  ]);

  return <ContactClassificationScreen initialContactTags={contactTags} initialContactTypes={contactTypes} />;
}

import { redirect } from "next/navigation";

import { UsersScreen } from "@/components/users/users-screen";
import { getCurrentUser } from "@/modules/auth/session";
import { listUsers } from "@/modules/users/service";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/conversas");

  const users = (await listUsers(user)).map(({ id, name, email, role, active }) => ({ id, name, email, role, active }));
  return <UsersScreen currentUser={user} initialUsers={users} />;
}

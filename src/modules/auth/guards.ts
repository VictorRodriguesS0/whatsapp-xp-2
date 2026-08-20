import "server-only";

import { UserRole } from "@/generated/prisma/enums";
import { getServerEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

import { getCurrentUser, type SessionUser } from "./session";

type CurrentUserResolver = () => Promise<SessionUser | null>;

export async function requireUser(
  currentUser: CurrentUserResolver = getCurrentUser,
): Promise<SessionUser> {
  const user = await currentUser();

  if (!user) {
    throw new HttpError(401, "Não autenticado");
  }

  return user;
}

export async function requireAdmin(
  currentUser: CurrentUserResolver = getCurrentUser,
): Promise<SessionUser> {
  const user = await requireUser(currentUser);

  if (user.role !== UserRole.ADMIN) {
    throw new HttpError(403, "Acesso negado");
  }

  return user;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const appOrigin = new URL(getServerEnv().NEXT_PUBLIC_APP_URL).origin;

  if (origin !== appOrigin) {
    throw new HttpError(403, "Origem inválida");
  }
}

import "server-only";

import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

export async function assertConnectionSendAllowed(): Promise<void> {
  const env = getServerEnv();
  if (env.WHATSAPP_PROVIDER !== "meta") return;
  const snapshot = await prisma.metaHealthSnapshot.findUnique({
    where: { phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID! },
    select: { connectionState: true },
  });
  if (snapshot?.connectionState === "DISCONNECTED") {
    throw new HttpError(503, "A integração com o WhatsApp está desconectada. Solicite a reconexão a um administrador.", "META_DISCONNECTED");
  }
}

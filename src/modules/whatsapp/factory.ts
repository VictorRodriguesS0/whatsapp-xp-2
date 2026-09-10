import "server-only";

import { assertConnectionSendAllowed } from "@/modules/meta-health/send-guard";
import { withConnectionGuard } from "./connection-guard";
import { getServerEnv } from "@/lib/env";

import { DemoWhatsAppProvider } from "./demo-provider";
import { MetaWhatsAppProvider } from "./meta-provider";
import type { WhatsAppProvider } from "./provider";

export function createWhatsAppProvider(): WhatsAppProvider {
  const env = getServerEnv();
  if (env.WHATSAPP_PROVIDER === "demo") return new DemoWhatsAppProvider();
  return withConnectionGuard(new MetaWhatsAppProvider({
    version: env.META_GRAPH_API_VERSION,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
    catalogId: env.WHATSAPP_CATALOG_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN!,
    timeoutMs: env.META_HTTP_TIMEOUT_MS,
  }), assertConnectionSendAllowed);
}

let provider: WhatsAppProvider | undefined;

export function getWhatsAppProvider(): WhatsAppProvider {
  provider ??= createWhatsAppProvider();
  return provider;
}

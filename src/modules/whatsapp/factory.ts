import "server-only";

import { getServerEnv } from "@/lib/env";

import { DemoWhatsAppProvider } from "./demo-provider";
import { MetaWhatsAppProvider } from "./meta-provider";
import type { WhatsAppProvider } from "./provider";

export function createWhatsAppProvider(): WhatsAppProvider {
  const env = getServerEnv();
  if (env.WHATSAPP_PROVIDER === "demo") return new DemoWhatsAppProvider();
  return new MetaWhatsAppProvider({
    version: env.META_GRAPH_API_VERSION,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
    accessToken: env.WHATSAPP_ACCESS_TOKEN!,
    timeoutMs: env.META_HTTP_TIMEOUT_MS,
  });
}

let provider: WhatsAppProvider | undefined;

export function getWhatsAppProvider(): WhatsAppProvider {
  provider ??= createWhatsAppProvider();
  return provider;
}

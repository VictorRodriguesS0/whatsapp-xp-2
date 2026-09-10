import "server-only";

import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env";
import { HttpError, SESSION_COOKIE_NAME } from "@/lib/http";
import { requireAdmin } from "@/modules/auth/guards";
import { hashSessionToken } from "@/modules/auth/session";
import { createMetaConnectionClient } from "./graph-client";
import { createMetaConnectionService, isConnectionConfigured, type ConnectionActor } from "./service";
import type { MetaConnectionConfig, MetaConnectionPublicConfig } from "./types";

function configuration(): MetaConnectionConfig {
  const env = getServerEnv();
  return {
    enabled: env.WHATSAPP_PROVIDER === "meta" && env.META_EMBEDDED_SIGNUP_ENABLED,
    appId: env.META_APP_ID ?? "", configId: env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? "",
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "", wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "",
    businessId: env.META_BUSINESS_ID ?? "", sdkVersion: env.META_EMBEDDED_SIGNUP_GRAPH_VERSION, appUrl: env.NEXT_PUBLIC_APP_URL,
  };
}

export function getMetaConnectionPublicConfig(): MetaConnectionPublicConfig {
  const config = configuration();
  const enabled = isConnectionConfigured(config);
  return { enabled, reason: enabled ? null : "A reconexão oficial precisa ser habilitada e configurada na Meta pelo responsável pela integração.", appId: enabled ? config.appId : null, configId: enabled ? config.configId : null, sdkVersion: config.sdkVersion };
}

export async function requireConnectionActor(): Promise<ConnectionActor> {
  const user = await requireAdmin();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new HttpError(401, "Não autenticado");
  return { user, sessionHash: hashSessionToken(token) };
}

export function getMetaConnectionService() {
  const env = getServerEnv();
  const config = configuration();
  return createMetaConnectionService({ config, client: createMetaConnectionClient({
    ...config, appSecret: env.META_APP_SECRET ?? "", accessToken: env.WHATSAPP_ACCESS_TOKEN ?? "",
    graphVersion: env.META_GRAPH_API_VERSION, timeoutMs: Math.min(env.META_HTTP_TIMEOUT_MS, 8_000),
  }) });
}

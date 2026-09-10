import "server-only";

import { appSubscribedToWaba, hasCoexistenceWebhookFields } from "@/modules/meta-health/subscriptions";
import { createHmac } from "node:crypto";
import { MetaConnectionError, type MetaConnectionClient } from "./types";

type Config = {
  appId: string; appSecret: string; accessToken: string; businessId: string;
  wabaId: string; phoneNumberId: string; graphVersion: string; timeoutMs: number;
  fetcher?: typeof fetch;
};
type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

async function readJson(response: Response): Promise<Json> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new MetaConnectionError(response.status === 401 || response.status === 403 ? "TOKEN_INVALID" : response.status >= 500 || response.status === 429 ? "META_UNAVAILABLE" : "META_INVALID_RESPONSE");
  }
  if (!response.body) throw new MetaConnectionError("META_INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 128 * 1024) {
        await reader.cancel();
        throw new MetaConnectionError("META_INVALID_RESPONSE");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new MetaConnectionError("META_INVALID_RESPONSE"); }
  if (!record(parsed)) throw new MetaConnectionError("META_INVALID_RESPONSE");
  return parsed;
}

export function createMetaConnectionClient(config: Config): MetaConnectionClient {
  const fetcher = config.fetcher ?? fetch;
  const appToken = `${config.appId}|${config.appSecret}`;
  const proof = (token: string) => createHmac("sha256", config.appSecret).update(token).digest("hex");
  async function request(path: string, token: string, query: Record<string, string> = {}, form?: URLSearchParams) {
    const url = new URL(`https://graph.facebook.com/${encodeURIComponent(config.graphVersion)}/${path}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    if (token !== appToken) url.searchParams.set("appsecret_proof", proof(token));
    try {
      return await readJson(await fetcher(url.toString(), {
        method: form ? "POST" : "GET", redirect: "error", cache: "no-store",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        ...(form ? { body: form.toString() } : {}), signal: AbortSignal.timeout(config.timeoutMs),
      }));
    } catch (error) {
      if (error instanceof MetaConnectionError) throw error;
      throw new MetaConnectionError("META_UNAVAILABLE");
    }
  }

  async function validateAccess(token: string) {
    const debug = await request("debug_token", appToken, { input_token: token });
    const data = debug.data;
    if (!record(data) || data.app_id !== config.appId || data.is_valid !== true || !Array.isArray(data.scopes) ||
      !["whatsapp_business_management", "whatsapp_business_messaging"].every((scope) => (data.scopes as unknown[]).includes(scope)) ||
      (typeof data.expires_at === "number" && data.expires_at !== 0 && data.expires_at * 1000 <= Date.now()) ||
      (typeof data.data_access_expires_at === "number" && data.data_access_expires_at !== 0 && data.data_access_expires_at * 1000 <= Date.now())) {
      throw new MetaConnectionError("TOKEN_INVALID");
    }
    const waba = await request(encodeURIComponent(config.wabaId), token, { fields: "id,owner_business_info" });
    if (waba.id !== config.wabaId || !record(waba.owner_business_info) || waba.owner_business_info.id !== config.businessId) throw new MetaConnectionError("ASSET_MISMATCH");
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const phones = await request(`${encodeURIComponent(config.wabaId)}/phone_numbers`, token, { fields: "id", limit: "100", ...(after ? { after } : {}) });
      if (!Array.isArray(phones.data) || phones.data.length > 100) throw new MetaConnectionError("META_INVALID_RESPONSE");
      if (phones.data.some((phone) => record(phone) && phone.id === config.phoneNumberId)) return;
      const paging = phones.paging;
      if (!record(paging) || !paging.next || !record(paging.cursors) || typeof paging.cursors.after !== "string" || paging.cursors.after.length > 2048) break;
      after = paging.cursors.after;
    }
    throw new MetaConnectionError("ASSET_MISMATCH");
  }

  async function subscribedToWaba() {
    // Only an exact app ID counts; a different provider's subscription is unrelated.
    const subscriptions = await request(`${encodeURIComponent(config.wabaId)}/subscribed_apps`, config.accessToken, { limit: "100" });
    const ready = appSubscribedToWaba(subscriptions, config.appId);
    if (ready === null) throw new MetaConnectionError("META_INVALID_RESPONSE");
    return ready;
  }

  async function hasRequiredWebhookFields() {
    const subscriptions = await request(`${encodeURIComponent(config.appId)}/subscriptions`, appToken);
    const ready = hasCoexistenceWebhookFields(subscriptions);
    if (ready === null) throw new MetaConnectionError("META_INVALID_RESPONSE");
    return ready;
  }

  return {
    async exchangeCode(code) {
      const grant = await request("oauth/access_token", appToken, {}, new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, code }));
      if (typeof grant.access_token !== "string" || grant.access_token.length < 1 || grant.access_token.length > 16_384) throw new MetaConnectionError("META_INVALID_RESPONSE");
      await validateAccess(grant.access_token);
      // The temporary grant is discarded. The configured permanent token remains authoritative.
    },
    async ensureSubscription() {
      await validateAccess(config.accessToken);
      if (!(await hasRequiredWebhookFields())) throw new MetaConnectionError("WEBHOOK_CONFIGURATION_REQUIRED");
      if (!(await subscribedToWaba())) {
        const result = await request(`${encodeURIComponent(config.wabaId)}/subscribed_apps`, config.accessToken, {}, new URLSearchParams());
        if (result.success !== true) throw new MetaConnectionError("META_INVALID_RESPONSE");
      }
    },
    async verifyConnection() {
      const phone = await request(encodeURIComponent(config.phoneNumberId), config.accessToken, { fields: "id,status,platform_type,is_on_biz_app" });
      if (phone.id !== config.phoneNumberId) throw new MetaConnectionError("ASSET_MISMATCH");
      const subscribed = await subscribedToWaba();
      const fieldsReady = await hasRequiredWebhookFields();
      const enumValue = (value: unknown) => typeof value === "string" && /^[A-Z_]{1,64}$/.test(value) ? value : null;
      return { connection: { status: enumValue(phone.status), platformType: enumValue(phone.platform_type), isOnBizApp: typeof phone.is_on_biz_app === "boolean" ? phone.is_on_biz_app : null }, subscribed: subscribed && fieldsReady };
    },
  };
}

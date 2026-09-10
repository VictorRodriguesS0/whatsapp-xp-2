"use client";

import type { MetaConnectionPublicConfig } from "./types";

export type SignupEvent = { kind: "FINISH"; wabaId: string; phoneNumberId?: string; businessId?: string } | { kind: "CANCEL" | "ERROR" };
type LoginResponse = { authResponse?: { code?: string } };
export type FacebookSdk = {
  init(options: { appId: string; version: string; autoLogAppEvents: boolean; xfbml: boolean }): void;
  login(callback: (response: LoginResponse) => void, options: {
    config_id: string; response_type: "code"; override_default_response_type: true;
    extras: { setup: Record<string, never>; featureType: "whatsapp_business_app_onboarding"; sessionInfoVersion: "3"; version: "v4" };
  }): void;
};
declare global { interface Window { FB?: FacebookSdk; fbAsyncInit?: () => void } }
const origins = new Set(["https://www.facebook.com", "https://web.facebook.com"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const asset = (value: unknown) => typeof value === "string" && /^\d{1,64}$/.test(value) ? value : undefined;

export function parseSignupEvent(event: Pick<MessageEvent, "origin" | "data">): SignupEvent | null {
  if (!origins.has(event.origin) || typeof event.data !== "string" || event.data.length > 16_384) return null;
  let payload: unknown;
  try { payload = JSON.parse(event.data); } catch { return null; }
  if (!record(payload) || payload.type !== "WA_EMBEDDED_SIGNUP" || (payload.version !== undefined && payload.version !== 3 && payload.version !== "3")) return null;
  if (payload.event === "CANCEL" || payload.event === "ERROR") return { kind: payload.event };
  if (payload.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" && payload.event !== "FINISH") return null;
  if (!record(payload.data)) return null;
  const wabaId = asset(payload.data.waba_id);
  if (!wabaId) return null;
  const phoneNumberId = asset(payload.data.phone_number_id);
  const businessId = asset(payload.data.business_id);
  if ((payload.data.phone_number_id !== undefined && !phoneNumberId) || (payload.data.business_id !== undefined && !businessId)) return null;
  return { kind: "FINISH", wabaId, ...(phoneNumberId ? { phoneNumberId } : {}), ...(businessId ? { businessId } : {}) };
}

let sdkPromise: Promise<FacebookSdk> | null = null;
export function loadEmbeddedSignupSdk(config: MetaConnectionPublicConfig): Promise<FacebookSdk> {
  if (!config.enabled || !config.appId || !config.configId) return Promise.reject(new Error("A reconexão ainda não está habilitada."));
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const finish = () => {
      if (settled || !window.FB) return;
      try {
        window.FB.init({ appId: config.appId!, version: config.sdkVersion, autoLogAppEvents: false, xfbml: false });
      } catch { fail(); return; }
      settled = true;
      clearTimeout(timeout);
      resolve(window.FB);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.remove();
      reject(new Error("Não foi possível carregar a janela da Meta. Verifique a conexão e o bloqueador do navegador."));
    };
    const timeout = setTimeout(fail, 12_000);
    window.fbAsyncInit = finish;
    if (window.FB) { finish(); return; }
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onload = finish;
    script.onerror = fail;
    document.head.append(script);
  }).catch((error: unknown) => { sdkPromise = null; throw error; });
  return sdkPromise;
}

export function launchEmbeddedSignup(sdk: FacebookSdk, config: MetaConnectionPublicConfig, callbacks: {
  onCode(code: string): void; onEvent(event: SignupEvent): void; onClose(): void;
}): () => void {
  if (!config.enabled || !config.configId) throw new Error("A reconexão ainda não está habilitada.");
  let active = true;
  let codeReceived = false;
  const listener = (event: MessageEvent) => {
    const parsed = parseSignupEvent(event);
    if (active && parsed) callbacks.onEvent(parsed);
  };
  const dispose = () => { active = false; window.removeEventListener("message", listener); };
  window.addEventListener("message", listener);
  try {
    // Called directly by the user's click so browser popup policies keep the gesture.
    sdk.login((response) => {
      if (!active) return;
      const code = response.authResponse?.code;
      if (typeof code === "string" && code.length > 0 && code.length <= 16_384 && !codeReceived) {
        codeReceived = true;
        callbacks.onCode(code);
      } else if (!codeReceived) callbacks.onClose();
    }, { config_id: config.configId, response_type: "code", override_default_response_type: true, extras: {
      setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3", version: "v4",
    } });
  } catch (error) { dispose(); throw error; }
  return dispose;
}

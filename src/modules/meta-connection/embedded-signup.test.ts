import { describe, expect, it, vi } from "vitest";
import { launchEmbeddedSignup, loadEmbeddedSignupSdk, parseSignupEvent, type FacebookSdk } from "./embedded-signup";

const config = { enabled: true, appId: "100", configId: "200", sdkVersion: "v26.0", reason: null };

describe("official signup callbacks", () => {
  it("accepts only exact Meta origins and bounded session information", () => {
    const data = JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", version: 3, event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "123" } });
    expect(parseSignupEvent({ origin: "https://www.facebook.com", data })).toEqual({ kind: "FINISH", wabaId: "123" });
    expect(parseSignupEvent({ origin: "https://web.facebook.com", data })).toEqual({ kind: "FINISH", wabaId: "123" });
    expect(parseSignupEvent({ origin: "https://unrelatedfacebook.com", data })).toBeNull();
    expect(parseSignupEvent({ origin: "https://www.facebook.com.unrelated.test", data })).toBeNull();
    expect(parseSignupEvent({ origin: "https://www.facebook.com", data: "x".repeat(20_000) })).toBeNull();
  });
  it("sends an OAuth code immediately without waiting for the finish event", () => {
    const onCode = vi.fn();
    const onEvent = vi.fn();
    const sdk: FacebookSdk = { init: vi.fn(), login: vi.fn((callback) => callback({ authResponse: { code: "private-code" } })) };
    const cleanup = launchEmbeddedSignup(sdk, config, { onCode, onEvent, onClose: vi.fn() });
    expect(onCode).toHaveBeenCalledWith("private-code");
    expect(onEvent).not.toHaveBeenCalled();
    expect(sdk.login).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ response_type: "code", extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3", version: "v4" } }));
    cleanup();
  });
  it("removes the listener when a flow is disposed and never emits provider error text", () => {
    const onEvent = vi.fn();
    const sdk: FacebookSdk = { init: vi.fn(), login: vi.fn() };
    const cleanup = launchEmbeddedSignup(sdk, config, { onCode: vi.fn(), onEvent, onClose: vi.fn() });
    window.dispatchEvent(new MessageEvent("message", { origin: "https://www.facebook.com", data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: { error_message: "private" } }) }));
    expect(onEvent).toHaveBeenLastCalledWith({ kind: "ERROR" });
    cleanup();
    window.dispatchEvent(new MessageEvent("message", { origin: "https://www.facebook.com", data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL" }) }));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});

it("allows another SDK load after an initialization failure", async () => {
  vi.useFakeTimers();
  try {
    window.FB = { init: vi.fn(() => { throw new Error("private SDK detail"); }), login: vi.fn() };
    const first = loadEmbeddedSignupSdk(config);
    const rejected = expect(first).rejects.toThrow("Não foi possível carregar");
    await vi.runAllTimersAsync();
    await rejected;
    window.FB.init = vi.fn();
    await expect(loadEmbeddedSignupSdk(config)).resolves.toBe(window.FB);
  } finally { delete window.FB; delete window.fbAsyncInit; vi.useRealTimers(); }
});

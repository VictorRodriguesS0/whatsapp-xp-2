import type { GraphConnection } from "@/modules/meta-health/connection";

export type ConnectionAttemptState = "WAITING" | "EXCHANGING" | "VERIFYING" | "CONNECTED" | "FAILED" | "CANCELLED" | "EXPIRED";
export type ConnectionAttemptDto = { id: string; state: ConnectionAttemptState; expiresAt: string; errorCode: string | null };
export type ConnectionAttemptProof = { id: string; nonce: string };
export type MetaConnectionConfig = {
  enabled: boolean; appId: string; configId: string; phoneNumberId: string;
  wabaId: string; businessId: string; sdkVersion: string; appUrl: string;
};
export type MetaConnectionPublicConfig = {
  enabled: boolean; reason: string | null; appId: string | null; configId: string | null; sdkVersion: string;
};
export type MetaConnectionClient = {
  exchangeCode(code: string): Promise<void>;
  ensureSubscription(): Promise<void>;
  verifyConnection(): Promise<{ connection: GraphConnection; subscribed: boolean }>;
};

export class MetaConnectionError extends Error {
  constructor(public readonly code: "ASSET_MISMATCH" | "TOKEN_INVALID" | "META_UNAVAILABLE" | "META_INVALID_RESPONSE" | "WEBHOOK_CONFIGURATION_REQUIRED") {
    super(code);
    this.name = "MetaConnectionError";
  }
}

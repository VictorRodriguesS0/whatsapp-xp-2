import "server-only";

import type {
  MetaHealthRemoteState,
  MetaRemoteQualityRating,
  MetaRemoteReviewStatus,
} from "./types";

export type MetaHealthGraphErrorCode =
  | "META_TIMEOUT"
  | "META_UNAUTHORIZED"
  | "META_RATE_LIMITED"
  | "META_UNAVAILABLE"
  | "META_INVALID_RESPONSE";

export class MetaHealthGraphError extends Error {
  constructor(public readonly code: MetaHealthGraphErrorCode) {
    super(code);
    this.name = "MetaHealthGraphError";
  }
}

export type MetaHealthGraphClient = {
  fetchState(): Promise<MetaHealthRemoteState>;
};

type MetaHealthGraphClientConfig = {
  graphVersion: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  timeoutMs: number;
  fetcher?: typeof fetch;
};

type JsonRecord = Record<string, unknown>;

const GRAPH_ORIGIN = "https://graph.facebook.com";
const MAXIMUM_JSON_BYTES = 2 * 1024 * 1024;
const MAXIMUM_TEMPLATE_PAGES = 10;
const MAXIMUM_TEMPLATES = 2_000;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicCodeForStatus(status: number): MetaHealthGraphErrorCode {
  if (status === 401 || status === 403) return "META_UNAUTHORIZED";
  if (status === 429) return "META_RATE_LIMITED";
  if (status >= 500 || status === 408) return "META_UNAVAILABLE";
  return "META_INVALID_RESPONSE";
}

function boundedString(
  value: unknown,
  maximum: number,
  pattern?: RegExp,
): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    return null;
  }
  if (/[\u0000-\u001f\u007f]/u.test(value) || (pattern && !pattern.test(value))) {
    return null;
  }
  return value;
}

async function boundedJson(response: Response): Promise<JsonRecord> {
  if (!response.ok) throw new MetaHealthGraphError(publicCodeForStatus(response.status));
  if (!response.body) throw new MetaHealthGraphError("META_INVALID_RESPONSE");

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_JSON_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw new MetaHealthGraphError("META_INVALID_RESPONSE");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAXIMUM_JSON_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new MetaHealthGraphError("META_INVALID_RESPONSE");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  let parsed: unknown;
  try {
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    if (error instanceof MetaHealthGraphError) throw error;
    throw new MetaHealthGraphError("META_INVALID_RESPONSE");
  }
  if (!isRecord(parsed)) throw new MetaHealthGraphError("META_INVALID_RESPONSE");
  return parsed;
}

function qualityRating(value: unknown): MetaRemoteQualityRating | null {
  return value === "GREEN" || value === "YELLOW" || value === "RED" || value === "NA"
    ? value
    : null;
}

function reviewStatus(value: unknown): MetaRemoteReviewStatus | null {
  return value === "PENDING" || value === "APPROVED" || value === "REJECTED"
    ? value
    : null;
}

function safePagingUrl(value: unknown, graphVersion: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 4_096) {
    throw new MetaHealthGraphError("META_INVALID_RESPONSE");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MetaHealthGraphError("META_INVALID_RESPONSE");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "graph.facebook.com" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith(`/${graphVersion}/`)
  ) {
    throw new MetaHealthGraphError("META_INVALID_RESPONSE");
  }
  return url.toString();
}

export function createMetaHealthGraphClient(
  config: MetaHealthGraphClientConfig,
): MetaHealthGraphClient {
  const fetcher = config.fetcher ?? fetch;
  const endpoint = (path: string) =>
    `${GRAPH_ORIGIN}/${encodeURIComponent(config.graphVersion)}/${path}`;

  async function get(url: string): Promise<JsonRecord> {
    const signal = AbortSignal.timeout(config.timeoutMs);
    try {
      return await boundedJson(
        await fetcher(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${config.accessToken}`,
          },
          signal,
        }),
      );
    } catch (error) {
      if (error instanceof MetaHealthGraphError) throw error;
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new MetaHealthGraphError("META_TIMEOUT");
      }
      throw new MetaHealthGraphError("META_UNAVAILABLE");
    }
  }

  return {
    async fetchState() {
      const phoneUrl = new URL(
        endpoint(encodeURIComponent(config.phoneNumberId)),
      );
      phoneUrl.searchParams.set(
        "fields",
        "id,display_phone_number,verified_name,quality_rating",
      );
      const phone = await get(phoneUrl.toString());
      if (phone.id !== config.phoneNumberId) {
        throw new MetaHealthGraphError("META_INVALID_RESPONSE");
      }

      const wabaUrl = new URL(endpoint(encodeURIComponent(config.wabaId)));
      wabaUrl.searchParams.set("fields", "id,account_review_status");
      const waba = await get(wabaUrl.toString());
      if (waba.id !== config.wabaId) {
        throw new MetaHealthGraphError("META_INVALID_RESPONSE");
      }

      const templates: MetaHealthRemoteState["templates"] = [];
      const initialTemplatesUrl = new URL(
        endpoint(`${encodeURIComponent(config.wabaId)}/message_templates`),
      );
      initialTemplatesUrl.searchParams.set("fields", "id,name,language,status");
      initialTemplatesUrl.searchParams.set("limit", "100");
      let next: string | null = initialTemplatesUrl.toString();

      for (let page = 0; next !== null; page += 1) {
        if (page >= MAXIMUM_TEMPLATE_PAGES) {
          throw new MetaHealthGraphError("META_INVALID_RESPONSE");
        }
        const payload = await get(next);
        if (!Array.isArray(payload.data)) {
          throw new MetaHealthGraphError("META_INVALID_RESPONSE");
        }
        for (const candidate of payload.data) {
          if (!isRecord(candidate) || templates.length >= MAXIMUM_TEMPLATES) {
            throw new MetaHealthGraphError("META_INVALID_RESPONSE");
          }
          const id = boundedString(candidate.id, 256, /^[A-Za-z0-9._-]+$/u);
          const name = boundedString(candidate.name, 512, /^[a-z0-9_]+$/u);
          const language = boundedString(
            candidate.language,
            32,
            /^[A-Za-z_-]+$/u,
          );
          const status = boundedString(candidate.status, 64, /^[A-Z_]+$/u);
          if (!id || !name || !language || !status) {
            throw new MetaHealthGraphError("META_INVALID_RESPONSE");
          }
          templates.push({ id, name, language, status });
        }
        const paging = payload.paging;
        if (paging === undefined || paging === null) {
          next = null;
        } else if (isRecord(paging)) {
          next = safePagingUrl(paging.next, config.graphVersion);
        } else {
          throw new MetaHealthGraphError("META_INVALID_RESPONSE");
        }
      }

      return {
        phoneNumberId: config.phoneNumberId,
        wabaId: config.wabaId,
        displayPhoneNumber: boundedString(phone.display_phone_number, 64),
        verifiedName: boundedString(phone.verified_name, 256),
        qualityRating: qualityRating(phone.quality_rating),
        accountReviewStatus: reviewStatus(waba.account_review_status),
        templates,
      };
    },
  };
}

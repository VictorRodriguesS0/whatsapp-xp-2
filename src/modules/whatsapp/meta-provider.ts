import "server-only";

import type {
  MediaDownload,
  MediaMetadata,
  MediaUploadSource,
  ProviderTemplate,
  TemplateSendInput,
  WhatsAppProvider,
} from "./provider";

type MetaProviderConfig = {
  version: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  timeoutMs?: number;
  maximumJsonBytes?: number;
};

type JsonRecord = Record<string, unknown>;

export type WhatsAppProviderErrorKind = "rejected" | "unknown";

export class WhatsAppProviderError extends Error {
  constructor(
    public readonly kind: WhatsAppProviderErrorKind,
    message = "Falha no provedor WhatsApp",
    public readonly graphCode: string | null = null,
  ) {
    super(message);
    this.name = "WhatsAppProviderError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAXIMUM_JSON_BYTES = 64 * 1024;
const MAXIMUM_TEMPLATE_PAGE_BYTES = 512 * 1024;
const MAXIMUM_TEMPLATE_PAGES = 20;
const MAXIMUM_TEMPLATES = 2_000;
const TEMPLATE_FIELDS =
  "id,name,status,category,language,quality_score,components";

function unknownProviderError(): WhatsAppProviderError {
  return new WhatsAppProviderError("unknown");
}

const DEFINITIVE_GRAPH_CLIENT_STATUSES = new Set([400, 401, 403, 404, 409, 410, 413, 415, 422]);

function providerErrorKindForStatus(status: number): WhatsAppProviderErrorKind {
  if (status === 408 || status === 429 || status >= 500) return "unknown";
  if (DEFINITIVE_GRAPH_CLIENT_STATUSES.has(status) || (status >= 300 && status < 400)) return "rejected";
  return "unknown";
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(unknownProviderError());
    if (signal.aborted) { reject(unknownProviderError()); return; }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedRequiredString(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw unknownProviderError();
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw unknownProviderError();
  return normalized;
}

function boundedNullableString(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  return boundedRequiredString(value, maximum);
}

function normalizeTemplateComponent(value: unknown) {
  if (!isRecord(value)) throw unknownProviderError();
  return {
    type: boundedRequiredString(value.type, 32),
    format: boundedNullableString(value.format, 32),
    text: boundedNullableString(value.text, 4_096),
  };
}

function normalizeQualityScore(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return boundedRequiredString(value, 32);
  if (!isRecord(value)) throw unknownProviderError();
  return boundedRequiredString(value.score, 32);
}

function normalizeProviderTemplate(value: unknown): ProviderTemplate {
  if (!isRecord(value) || !Array.isArray(value.components)) {
    throw unknownProviderError();
  }
  if (value.components.length > 32) throw unknownProviderError();
  return {
    metaId: boundedRequiredString(value.id, 256),
    name: boundedRequiredString(value.name, 512),
    language: boundedRequiredString(value.language, 32),
    category: boundedRequiredString(value.category, 64),
    status: boundedRequiredString(value.status, 64),
    qualityScore: normalizeQualityScore(value.quality_score),
    components: value.components.map(normalizeTemplateComponent),
  };
}

export class MetaWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private readonly config: MetaProviderConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  private endpoint(path: string): string {
    return `https://graph.facebook.com/${this.config.version}/${path}`;
  }

  private authorizationHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.config.accessToken}`, ...extra };
  }

  private async operation<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      return await raceWithAbort(work(controller.signal), controller.signal);
    } catch (error) {
      if (error instanceof WhatsAppProviderError) throw error;
      throw unknownProviderError();
    } finally {
      clearTimeout(timer);
    }
  }

  private async json(
    response: Response,
    signal: AbortSignal,
    maximumBytes = this.config.maximumJsonBytes ?? DEFAULT_MAXIMUM_JSON_BYTES,
  ): Promise<JsonRecord> {
    if (!response.body) throw unknownProviderError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await raceWithAbort(reader.read(), signal);
        if (result.done) break;
        total += result.value.byteLength;
        if (total > maximumBytes) {
          await reader.cancel().catch(() => undefined);
          throw unknownProviderError();
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      throw unknownProviderError();
    }

    if (!response.ok) {
      const graphError = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
      const sanitizedCode =
        typeof graphError.code === "number" || typeof graphError.code === "string"
          ? String(graphError.code)
              .replace(/[^0-9A-Za-z_-]/g, "")
              .slice(0, 32)
          : "";
      const graphCode = sanitizedCode || null;
      const rawMessage = typeof graphError.message === "string" ? graphError.message : "request_failed";
      const message = rawMessage
        .replaceAll(this.config.accessToken, "[REDACTED]")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, 160);
      throw new WhatsAppProviderError(
        providerErrorKindForStatus(response.status),
        `Graph ${graphCode ?? "unknown"}: ${message || "request_failed"}`,
        graphCode,
      );
    }

    if (!isRecord(payload)) throw unknownProviderError();
    return payload;
  }

  private async send(body: JsonRecord) {
    return this.operation(async (signal) => {
      const response = await this.request(this.endpoint(`${encodeURIComponent(this.config.phoneNumberId)}/messages`), {
        method: "POST",
        headers: this.authorizationHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal,
      });
      const payload = await this.json(response, signal);
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const first = messages[0];
      if (!isRecord(first) || typeof first.id !== "string" || !first.id) throw unknownProviderError();
      return { whatsappMessageId: first.id, status: "SENT" as const };
    });
  }

  async listTemplates(): Promise<ProviderTemplate[]> {
    return this.operation(async (signal) => {
      const templates: ProviderTemplate[] = [];
      const seenCursors = new Set<string>();
      let after: string | null = null;

      for (let page = 0; page < MAXIMUM_TEMPLATE_PAGES; page += 1) {
        const url = new URL(
          this.endpoint(
            `${encodeURIComponent(this.config.businessAccountId)}/message_templates`,
          ),
        );
        url.searchParams.set("fields", TEMPLATE_FIELDS);
        url.searchParams.set("limit", "100");
        if (after) url.searchParams.set("after", after);

        const response = await this.request(url.toString(), {
          headers: this.authorizationHeaders(),
          signal,
        });
        const payload = await this.json(
          response,
          signal,
          MAXIMUM_TEMPLATE_PAGE_BYTES,
        );
        if (!Array.isArray(payload.data)) throw unknownProviderError();
        if (templates.length + payload.data.length > MAXIMUM_TEMPLATES) {
          throw unknownProviderError();
        }
        templates.push(...payload.data.map(normalizeProviderTemplate));

        const paging = payload.paging;
        if (paging === undefined || paging === null) return templates;
        if (!isRecord(paging)) throw unknownProviderError();
        const cursors = paging.cursors;
        if (cursors === undefined || cursors === null) return templates;
        if (!isRecord(cursors)) throw unknownProviderError();
        if (cursors.after === undefined || cursors.after === null) return templates;
        const nextAfter = boundedRequiredString(cursors.after, 2_048);
        if (seenCursors.has(nextAfter)) throw unknownProviderError();
        seenCursors.add(nextAfter);
        after = nextAfter;
      }

      throw unknownProviderError();
    });
  }

  sendTemplate(input: TemplateSendInput) {
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "template",
      template: {
        name: input.name,
        language: { code: input.language },
        components: [
          { type: "body", parameters: input.bodyParameters },
        ],
      },
    });
  }

  async markRead(input: { messageId: string }): Promise<void> {
    await this.operation(async (signal) => {
      const response = await this.request(
        this.endpoint(`${encodeURIComponent(this.config.phoneNumberId)}/messages`),
        {
          method: "POST",
          headers: this.authorizationHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            messaging_product: "whatsapp",
            status: "read",
            message_id: input.messageId,
          }),
          signal,
        },
      );
      const payload = await this.json(response, signal);
      if (payload.success !== true) throw unknownProviderError();
    });
  }

  sendText(input: { to: string; body: string; contextMessageId?: string }) {
    const context = input.contextMessageId
      ? { context: { message_id: input.contextMessageId } }
      : {};
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      ...context,
      type: "text",
      text: { body: input.body, preview_url: false },
    });
  }

  sendReaction(input: { to: string; targetWhatsappMessageId: string; emoji: string }) {
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "reaction",
      reaction: {
        message_id: input.targetWhatsappMessageId,
        emoji: input.emoji,
      },
    });
  }

  async uploadMedia(input: MediaUploadSource) {
    return this.operation(async (signal) => {
      const boundary = `xp-${crypto.randomUUID()}`;
      const safeFilename = input.filename.replace(/[\r\n"\\]/g, "_");
      const prefix = new TextEncoder().encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${input.mimeType}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
      );
      const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
      const fileStream = await input.open();
      const fileReader = fileStream.getReader();
      let phase = 0;
      let streamed = 0n;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (phase === 0) { phase = 1; controller.enqueue(prefix); return; }
          if (phase === 1) {
            const result = await raceWithAbort(fileReader.read(), signal);
            if (!result.done) { streamed += BigInt(result.value.byteLength); controller.enqueue(result.value); return; }
            fileReader.releaseLock();
            if (streamed !== input.sizeBytes) { controller.error(unknownProviderError()); return; }
            phase = 2; controller.enqueue(suffix); return;
          }
          controller.close();
        },
        async cancel() { await fileReader.cancel().catch(() => undefined); fileReader.releaseLock(); },
      });
      const contentLength = BigInt(prefix.byteLength) + input.sizeBytes + BigInt(suffix.byteLength);
      const response = await this.request(this.endpoint(`${encodeURIComponent(this.config.phoneNumberId)}/media`), {
        method: "POST",
        headers: this.authorizationHeaders({
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": contentLength.toString(),
        }),
        body,
        signal,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      const payload = await this.json(response, signal);
      if (typeof payload.id !== "string" || !payload.id) throw unknownProviderError();
      return { mediaId: payload.id };
    });
  }

  sendMedia(input: { to: string; type: "image" | "audio" | "video" | "document"; mediaId: string; caption?: string; filename?: string; contextMessageId?: string }) {
    const media: JsonRecord = { id: input.mediaId };
    if (input.caption && input.type !== "audio") media.caption = input.caption;
    if (input.filename && input.type === "document") media.filename = input.filename;
    const context = input.contextMessageId
      ? { context: { message_id: input.contextMessageId } }
      : {};
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      ...context,
      type: input.type,
      [input.type]: media,
    });
  }

  private assertSafeTemporaryUrl(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new WhatsAppProviderError("rejected", "URL temporária de mídia inválida");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "lookaside.fbsbx.com" ||
      (url.port !== "" && url.port !== "443") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw new WhatsAppProviderError("rejected", "URL temporária de mídia inválida");
    }
    return url;
  }

  async getMediaMetadata(mediaId: string): Promise<MediaMetadata> {
    if (!/^[A-Za-z0-9._-]{1,256}$/.test(mediaId)) throw new WhatsAppProviderError("rejected");
    return this.operation(async (signal) => {
      const url = new URL(this.endpoint(encodeURIComponent(mediaId)));
      url.searchParams.set("phone_number_id", this.config.phoneNumberId);
      const payload = await this.json(await this.request(url.toString(), {
        headers: this.authorizationHeaders(), signal,
      }), signal);
    if (
      typeof payload.id !== "string" ||
      typeof payload.url !== "string" ||
      typeof payload.mime_type !== "string" ||
      (typeof payload.file_size !== "number" && typeof payload.file_size !== "string")
      ) throw unknownProviderError();
    this.assertSafeTemporaryUrl(payload.url);
    let sizeBytes: bigint;
    try {
      sizeBytes = BigInt(payload.file_size);
    } catch {
      throw unknownProviderError();
    }
      if (sizeBytes < 0n) throw unknownProviderError();
      return {
      id: payload.id,
      url: payload.url,
      mimeType: payload.mime_type.trim().toLowerCase(),
      sha256: typeof payload.sha256 === "string" ? payload.sha256 : null,
      sizeBytes,
      };
    });
  }

  async downloadMedia(input: { url: string; maximumBytes: number }): Promise<MediaDownload> {
    const url = this.assertSafeTemporaryUrl(input.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await raceWithAbort(
        this.request(url.toString(), { headers: this.authorizationHeaders(), redirect: "manual", signal: controller.signal }),
        controller.signal,
      );
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof WhatsAppProviderError) throw error;
      throw unknownProviderError();
    }
    if (!response.ok || response.status >= 300 || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      clearTimeout(timer);
      throw new WhatsAppProviderError(
        response.status >= 300 && response.status < 400 ? "rejected" : providerErrorKindForStatus(response.status),
      );
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && (!/^\d+$/.test(contentLength) || BigInt(contentLength) > BigInt(input.maximumBytes))) {
      await response.body.cancel().catch(() => undefined);
      clearTimeout(timer);
      throw new WhatsAppProviderError("rejected", "Mídia remota muito grande");
    }
    const expectedSize = contentLength && /^\d+$/.test(contentLength) ? BigInt(contentLength) : null;
    const reader = response.body.getReader();
    let total = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const result = await raceWithAbort(reader.read(), controller.signal);
          if (result.done) {
            clearTimeout(timer);
            if (expectedSize !== null && BigInt(total) !== expectedSize) {
              streamController.error(unknownProviderError());
              return;
            }
            streamController.close();
            return;
          }
          total += result.value.byteLength;
        if (total > input.maximumBytes) {
          await reader.cancel().catch(() => undefined);
            clearTimeout(timer);
            streamController.error(new WhatsAppProviderError("rejected", "Mídia remota muito grande"));
            return;
        }
          streamController.enqueue(result.value);
        } catch (error) {
          clearTimeout(timer);
          streamController.error(error instanceof WhatsAppProviderError ? error : unknownProviderError());
        }
      },
      async cancel() {
        clearTimeout(timer);
        controller.abort();
        await reader.cancel().catch(() => undefined);
      }
    });
    return {
      stream,
      mimeType: (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase(),
      sizeBytes: expectedSize,
    };
  }
}

import "server-only";

import type { MediaMetadata, WhatsAppProvider } from "./provider";

type MetaProviderConfig = {
  version: string;
  phoneNumberId: string;
  accessToken: string;
};

type JsonRecord = Record<string, unknown>;

export class WhatsAppProviderError extends Error {
  constructor(message = "Falha no provedor WhatsApp") {
    super(message);
    this.name = "WhatsAppProviderError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

  private async json(response: Response): Promise<JsonRecord> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WhatsAppProviderError();
    }

    if (!response.ok) {
      const graphError = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
      const code = typeof graphError.code === "number" || typeof graphError.code === "string"
        ? String(graphError.code).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 32)
        : "unknown";
      const rawMessage = typeof graphError.message === "string" ? graphError.message : "request_failed";
      const message = rawMessage
        .replaceAll(this.config.accessToken, "[REDACTED]")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, 160);
      throw new WhatsAppProviderError(`Graph ${code}: ${message || "request_failed"}`);
    }

    if (!isRecord(payload)) throw new WhatsAppProviderError();
    return payload;
  }

  private async send(body: JsonRecord) {
    const response = await this.request(this.endpoint(`${encodeURIComponent(this.config.phoneNumberId)}/messages`), {
      method: "POST",
      headers: this.authorizationHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const payload = await this.json(response);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const first = messages[0];
    if (!isRecord(first) || typeof first.id !== "string" || !first.id) throw new WhatsAppProviderError();
    return { whatsappMessageId: first.id, status: "SENT" as const };
  }

  sendText(input: { to: string; body: string }) {
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: { body: input.body, preview_url: false },
    });
  }

  async uploadMedia(input: { bytes: Uint8Array; filename: string; mimeType: string }) {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", input.mimeType);
    const bytes = Uint8Array.from(input.bytes);
    form.set("file", new Blob([bytes], { type: input.mimeType }), input.filename);
    const response = await this.request(this.endpoint(`${encodeURIComponent(this.config.phoneNumberId)}/media`), {
      method: "POST",
      headers: this.authorizationHeaders(),
      body: form,
    });
    const payload = await this.json(response);
    if (typeof payload.id !== "string" || !payload.id) throw new WhatsAppProviderError();
    return { mediaId: payload.id };
  }

  sendMedia(input: { to: string; type: "image" | "audio" | "video" | "document"; mediaId: string; caption?: string; filename?: string }) {
    const media: JsonRecord = { id: input.mediaId };
    if (input.caption && input.type !== "audio") media.caption = input.caption;
    if (input.filename && input.type === "document") media.filename = input.filename;
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: input.type,
      [input.type]: media,
    });
  }

  private assertSafeTemporaryUrl(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new WhatsAppProviderError("URL temporária de mídia inválida");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "lookaside.fbsbx.com" ||
      (url.port !== "" && url.port !== "443") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw new WhatsAppProviderError("URL temporária de mídia inválida");
    }
    return url;
  }

  async getMediaMetadata(mediaId: string): Promise<MediaMetadata> {
    if (!/^[A-Za-z0-9._-]{1,256}$/.test(mediaId)) throw new WhatsAppProviderError();
    const url = new URL(this.endpoint(encodeURIComponent(mediaId)));
    url.searchParams.set("phone_number_id", this.config.phoneNumberId);
    const payload = await this.json(await this.request(url.toString(), {
      headers: this.authorizationHeaders(),
    }));
    if (
      typeof payload.id !== "string" ||
      typeof payload.url !== "string" ||
      typeof payload.mime_type !== "string" ||
      (typeof payload.file_size !== "number" && typeof payload.file_size !== "string")
    ) throw new WhatsAppProviderError();
    this.assertSafeTemporaryUrl(payload.url);
    let sizeBytes: bigint;
    try {
      sizeBytes = BigInt(payload.file_size);
    } catch {
      throw new WhatsAppProviderError();
    }
    if (sizeBytes < 0n) throw new WhatsAppProviderError();
    return {
      id: payload.id,
      url: payload.url,
      mimeType: payload.mime_type.trim().toLowerCase(),
      sha256: typeof payload.sha256 === "string" ? payload.sha256 : null,
      sizeBytes,
    };
  }

  async downloadMedia(input: { url: string; maximumBytes: number }) {
    const url = this.assertSafeTemporaryUrl(input.url);
    const response = await this.request(url.toString(), {
      headers: this.authorizationHeaders(),
      redirect: "manual",
    });
    if (!response.ok || response.status >= 300 || !response.body) throw new WhatsAppProviderError();
    const contentLength = response.headers.get("content-length");
    if (contentLength && (!/^\d+$/.test(contentLength) || BigInt(contentLength) > BigInt(input.maximumBytes))) {
      await response.body.cancel().catch(() => undefined);
      throw new WhatsAppProviderError("Mídia remota muito grande");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > input.maximumBytes) {
          await reader.cancel().catch(() => undefined);
          throw new WhatsAppProviderError("Mídia remota muito grande");
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      bytes,
      mimeType: (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase(),
    };
  }
}

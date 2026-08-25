import "server-only";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { getCatalogService } from "./factory";
import type { CatalogProduct } from "./schemas";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAXIMUM_BYTES = 5 * 1024 * 1024;
const MAXIMUM_REDIRECTS = 3;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type CatalogImageProxyErrorCode =
  | "IMAGE_UNAVAILABLE"
  | "IMAGE_TIMEOUT"
  | "IMAGE_TOO_LARGE"
  | "TOO_MANY_REDIRECTS"
  | "UNSAFE_ORIGIN"
  | "UNSUPPORTED_IMAGE";

export class CatalogImageProxyError extends Error {
  constructor(public readonly code: CatalogImageProxyErrorCode) {
    super(code);
    this.name = "CatalogImageProxyError";
  }
}

export type CatalogProductImage = {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
};

type CatalogImageProxy = {
  fetchProductImage(retailerId: string): Promise<CatalogProductImage>;
};

type ResolveProduct = (retailerId: string) => Promise<CatalogProduct>;
type ResolveHost = (hostname: string) => Promise<string[]>;
type RequestImage = (url: string, init: RequestInit) => Promise<Response>;

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function normalizedHostname(url: URL): string {
  return url.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedAddresses.check(address, "ipv4");
  if (family === 6) return blockedAddresses.check(address, "ipv6");
  return true;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address }) => address);
}

async function assertSafeUrl(value: string, resolveHost: ResolveHost): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CatalogImageProxyError("UNSAFE_ORIGIN");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    throw new CatalogImageProxyError("UNSAFE_ORIGIN");
  }

  const hostname = normalizedHostname(url);
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new CatalogImageProxyError("UNSAFE_ORIGIN");
  }

  const literalFamily = isIP(hostname);
  let addresses: string[];
  try {
    addresses = literalFamily ? [hostname] : await resolveHost(hostname);
  } catch {
    throw new CatalogImageProxyError("IMAGE_UNAVAILABLE");
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => isIP(address) === 0 || isBlockedAddress(address))
  ) {
    throw new CatalogImageProxyError("UNSAFE_ORIGIN");
  }
  return url;
}

function hasExpectedSignature(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12 &&
      new TextDecoder("ascii").decode(bytes.subarray(0, 4)) === "RIFF" &&
      new TextDecoder("ascii").decode(bytes.subarray(8, 12)) === "WEBP";
  }
  return false;
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength) || BigInt(declaredLength) > BigInt(maximumBytes)) {
      throw new CatalogImageProxyError("IMAGE_TOO_LARGE");
    }
  }
  if (!response.body) throw new CatalogImageProxyError("IMAGE_UNAVAILABLE");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new CatalogImageProxyError("IMAGE_TOO_LARGE");
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof CatalogImageProxyError) throw error;
    throw new CatalogImageProxyError("IMAGE_UNAVAILABLE");
  }

  if (total === 0) throw new CatalogImageProxyError("UNSUPPORTED_IMAGE");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchWithDeadline<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CatalogImageProxyError("IMAGE_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } catch (error) {
    if (error instanceof CatalogImageProxyError) throw error;
    if (controller.signal.aborted) throw new CatalogImageProxyError("IMAGE_TIMEOUT");
    throw new CatalogImageProxyError("IMAGE_UNAVAILABLE");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createCatalogImageProxy(input: {
  resolveProduct: ResolveProduct;
  resolveHost?: ResolveHost;
  request?: RequestImage;
  timeoutMs?: number;
  maximumBytes?: number;
}): CatalogImageProxy {
  const resolveHost = input.resolveHost ?? defaultResolveHost;
  const request = input.request ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maximumBytes = input.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;

  return {
    async fetchProductImage(retailerId) {
      let product: CatalogProduct;
      try {
        product = await input.resolveProduct(retailerId);
      } catch {
        throw new CatalogImageProxyError("IMAGE_UNAVAILABLE");
      }
      if (!product.imageUrl) throw new CatalogImageProxyError("IMAGE_UNAVAILABLE");

      return fetchWithDeadline(timeoutMs, async (signal) => {
        let url = await assertSafeUrl(product.imageUrl!, resolveHost);
        for (let redirects = 0; ; redirects += 1) {
          let response: Response;
          try {
            response = await request(url.toString(), {
              method: "GET",
              headers: {
                accept: "image/jpeg, image/png, image/webp",
                "user-agent": "XP-Atendimento-Catalog-Image/1.0",
              },
              redirect: "manual",
              signal,
            });
          } catch (error) {
            if (signal.aborted) throw new CatalogImageProxyError("IMAGE_TIMEOUT");
            throw error;
          }

          if (REDIRECT_STATUSES.has(response.status)) {
            if (redirects >= MAXIMUM_REDIRECTS) {
              await response.body?.cancel().catch(() => undefined);
              throw new CatalogImageProxyError("TOO_MANY_REDIRECTS");
            }
            const location = response.headers.get("location");
            await response.body?.cancel().catch(() => undefined);
            if (!location) throw new CatalogImageProxyError("UNSAFE_ORIGIN");
            let redirected: URL;
            try {
              redirected = new URL(location, url);
            } catch {
              throw new CatalogImageProxyError("UNSAFE_ORIGIN");
            }
            url = await assertSafeUrl(redirected.toString(), resolveHost);
            continue;
          }

          if (!response.ok) throw new CatalogImageProxyError("IMAGE_UNAVAILABLE");
          const contentType = response.headers.get("content-type")
            ?.split(";", 1)[0]
            ?.trim()
            .toLowerCase();
          if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
            await response.body?.cancel().catch(() => undefined);
            throw new CatalogImageProxyError("UNSUPPORTED_IMAGE");
          }
          const bytes = await readBoundedBody(response, maximumBytes);
          if (!hasExpectedSignature(bytes, contentType)) {
            throw new CatalogImageProxyError("UNSUPPORTED_IMAGE");
          }
          return {
            bytes,
            contentType: contentType as CatalogProductImage["contentType"],
          };
        }
      });
    },
  };
}

let singleton: CatalogImageProxy | undefined;

export function getCatalogProductImage(retailerId: string): Promise<CatalogProductImage> {
  singleton ??= createCatalogImageProxy({
    resolveProduct: (knownRetailerId) => getCatalogService().resolveProduct(knownRetailerId),
  });
  return singleton.fetchProductImage(retailerId);
}

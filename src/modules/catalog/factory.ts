import "server-only";

import { getServerEnv, type ServerEnv } from "@/lib/env";

import {
  createMetaCatalogGraphClient,
  type MetaCatalogGraphClient,
} from "./graph-client";
import { createCatalogService, type CatalogService } from "./service";

type ClientFactory = (input: {
  graphVersion: string;
  catalogId: string;
  phoneNumberId: string;
  accessToken: string;
  timeoutMs: number;
}) => MetaCatalogGraphClient;

export function createCatalogServiceFromEnv(
  env: ServerEnv,
  dependencies: { clientFactory?: ClientFactory } = {},
): CatalogService {
  if (
    env.WHATSAPP_PROVIDER !== "meta" ||
    !env.WHATSAPP_CATALOG_ID ||
    !env.WHATSAPP_PHONE_NUMBER_ID ||
    !env.WHATSAPP_ACCESS_TOKEN
  ) {
    return createCatalogService({ catalogId: null, client: null });
  }

  const clientFactory = dependencies.clientFactory ?? createMetaCatalogGraphClient;
  const client = clientFactory({
    graphVersion: env.META_GRAPH_API_VERSION,
    catalogId: env.WHATSAPP_CATALOG_ID,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    timeoutMs: env.META_HTTP_TIMEOUT_MS,
  });
  return createCatalogService({ catalogId: env.WHATSAPP_CATALOG_ID, client });
}

let singleton: CatalogService | undefined;

export function getCatalogService(): CatalogService {
  singleton ??= createCatalogServiceFromEnv(getServerEnv());
  return singleton;
}

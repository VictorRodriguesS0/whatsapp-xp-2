import { z, ZodError } from "zod";
import { HttpError } from "@/lib/http";
import { assertSameOrigin } from "@/modules/auth/guards";
import { getMetaConnectionPublicConfig, getMetaConnectionService, requireConnectionActor } from "@/modules/meta-connection/config";

export const runtime = "nodejs";

const id = z.string().uuid();
const nonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const assetId = z.string().regex(/^\d{1,64}$/);
const bodySchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start") }),
  z.strictObject({ action: z.literal("exchange"), id, nonce, code: z.string().min(1).max(16_384).regex(/^[^\s\u0000-\u001f\u007f]+$/) }),
  z.strictObject({ action: z.literal("finish"), id, nonce, wabaId: assetId, phoneNumberId: assetId.optional(), businessId: assetId.optional() }),
  z.strictObject({ action: z.literal("reconcile"), id }),
  z.strictObject({ action: z.literal("cancel"), id }),
]);

async function body(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Envie dados JSON");
  if (!request.body) throw new HttpError(400, "Dados inválidos");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let expired = false;
  const timeout = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, 5_000);
  try {
    while (true) {
      const part = await reader.read();
      if (expired) throw new HttpError(408, "Tempo de envio dos dados excedido");
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 32 * 1024) { await reader.cancel(); throw new HttpError(413, "Dados excedem o limite permitido"); }
      chunks.push(part.value);
    }
  } finally { clearTimeout(timeout); reader.releaseLock(); }
  return bodySchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
function errorResponse(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof ZodError || error instanceof SyntaxError) return json({ error: "Dados inválidos" }, 400);
  return json({ error: "Não foi possível concluir a operação. Consulte o estado da conexão antes de tentar novamente." }, 500);
}

type Dependencies = {
  actor: typeof requireConnectionActor; assertSameOrigin: typeof assertSameOrigin;
  service: typeof getMetaConnectionService; config: typeof getMetaConnectionPublicConfig;
};
export function createMetaConnectionHandlers(dependencies: Dependencies = {
  actor: requireConnectionActor, assertSameOrigin, service: getMetaConnectionService, config: getMetaConnectionPublicConfig,
}) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.actor();
        return json({ config: dependencies.config(), attempt: await dependencies.service().latest(actor) });
      } catch (error) { return errorResponse(error); }
    },
    POST: async (request: Request): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.actor();
        const input = await body(request);
        const service = dependencies.service();
        switch (input.action) {
          case "start": return json({ attempt: await service.start(actor) });
          case "exchange": return json({ attempt: await service.exchange(actor, input) });
          case "finish": return json({ attempt: await service.finish(actor, input) });
          case "reconcile": return json({ attempt: await service.reconcile(actor, input) });
          case "cancel": return json({ attempt: await service.cancel(actor, input.id) });
        }
      } catch (error) { return errorResponse(error); }
    },
  };
}

export const { GET, POST } = createMetaConnectionHandlers();

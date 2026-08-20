import { HttpError, toErrorResponse } from "@/lib/http";
import { requireUser } from "@/modules/auth/guards";
import { getMediaForDownload } from "@/modules/media/service";
import { messageUuidSchema } from "@/modules/messages/schemas";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type MediaRouteDependencies = {
  requireUser: typeof requireUser;
  getMediaForDownload: typeof getMediaForDownload;
};

const defaultDependencies: MediaRouteDependencies = { requireUser, getMediaForDownload };

function disposition(filename: string, attachment: boolean): string {
  const safeFilename = filename.split(/[\r\n]/, 1)[0] || "arquivo";
  const ascii = safeFilename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\;\r\n]/g, "_")
    .slice(0, 180) || "arquivo";
  const encoded = encodeURIComponent(safeFilename).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${attachment ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function createMediaRouteHandlers(
  dependencies: MediaRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (_request: Request, context: RouteContext): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsed = messageUuidSchema.safeParse(id);
        if (!parsed.success) throw new HttpError(404, "Mídia não encontrada");
        const media = await dependencies.getMediaForDownload(actor.id, parsed.data);
        return new Response(media.stream, {
          headers: {
            "Content-Type": media.mimeType,
            "Content-Length": media.sizeBytes.toString(),
            "Content-Disposition": disposition(media.filename, media.kind === "document"),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
          },
        });
      } catch (error) {
        if (error instanceof HttpError) return toErrorResponse(error);
        return toErrorResponse(error);
      }
    },
  };
}

export const GET = createMediaRouteHandlers().GET;

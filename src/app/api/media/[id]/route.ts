import { HttpError, toErrorResponse } from "@/lib/http";
import { requireUser } from "@/modules/auth/guards";
import {
  getMediaForDownload,
  MediaRangeNotSatisfiableError,
} from "@/modules/media/service";
import { messageUuidSchema } from "@/modules/messages/schemas";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type MediaDownload = Awaited<ReturnType<typeof getMediaForDownload>>;
type MediaRouteDependencies = {
  requireUser: typeof requireUser;
  getMediaForDownload: (
    actorId: string,
    mediaId: string,
    options?: { rangeHeader?: string | null },
  ) => Promise<MediaDownload>;
};

const defaultDependencies: MediaRouteDependencies = {
  requireUser,
  getMediaForDownload: (actorId, mediaId, options) => (
    getMediaForDownload(actorId, mediaId, undefined, options)
  ),
};

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
    GET: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsed = messageUuidSchema.safeParse(id);
        if (!parsed.success) throw new HttpError(404, "Mídia não encontrada");
        const media = await dependencies.getMediaForDownload(actor.id, parsed.data, {
          rangeHeader: request.headers.get("range"),
        });
        const url = new URL(request.url);
        const previewPdf = url.searchParams.get("preview") === "1" && media.mimeType === "application/pdf";
        const forceDownload = url.searchParams.get("download") === "1";
        const attachment = forceDownload || (media.kind === "document" && !previewPdf);
        const headers: Record<string, string> = {
          "Content-Type": media.mimeType,
          "Content-Length": (media.range?.length ?? media.sizeBytes).toString(),
          "Content-Disposition": disposition(media.filename, attachment),
          "Accept-Ranges": "bytes",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        };
        if (media.range) {
          headers["Content-Range"] = `bytes ${media.range.start}-${media.range.end}/${media.sizeBytes}`;
        }
        return new Response(media.stream, {
          status: media.range ? 206 : 200,
          headers,
        });
      } catch (error) {
        if (error instanceof MediaRangeNotSatisfiableError) {
          return Response.json(
            { error: error.message },
            {
              status: 416,
              headers: {
                "Content-Range": `bytes */${error.sizeBytes}`,
                "Accept-Ranges": "bytes",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
              },
            },
          );
        }
        if (error instanceof HttpError) return toErrorResponse(error);
        return toErrorResponse(error);
      }
    },
  };
}

export const GET = createMediaRouteHandlers().GET;

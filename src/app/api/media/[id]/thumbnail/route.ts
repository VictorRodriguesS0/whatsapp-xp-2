import { HttpError, toErrorResponse } from "@/lib/http";
import { requireUser } from "@/modules/auth/guards";
import { getPdfThumbnail } from "@/modules/media/pdf-thumbnail";
import { messageUuidSchema } from "@/modules/messages/schemas";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type PdfThumbnailRouteDependencies = {
  requireUser: typeof requireUser;
  getPdfThumbnail: typeof getPdfThumbnail;
};

const defaultDependencies: PdfThumbnailRouteDependencies = {
  requireUser,
  getPdfThumbnail,
};

export function createPdfThumbnailRouteHandlers(
  dependencies: PdfThumbnailRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (_request: Request, context: RouteContext): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const parsed = messageUuidSchema.safeParse((await context.params).id);
        if (!parsed.success) throw new HttpError(404, "Mídia não encontrada");
        const thumbnail = await dependencies.getPdfThumbnail(actor.id, parsed.data);
        return new Response(thumbnail.stream, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Content-Length": thumbnail.sizeBytes.toString(),
            "Content-Disposition": "inline; filename=\"preview.png\"",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}

export const GET = createPdfThumbnailRouteHandlers().GET;

import { HttpError, toErrorResponse } from "@/lib/http";
import { requireUser } from "@/modules/auth/guards";
import { getCatalogProductImage } from "@/modules/catalog/image-proxy";
import { catalogRetailerIdSchema } from "@/modules/catalog/schemas";

export const runtime = "nodejs";

const CACHE_CONTROL = "private, max-age=300, stale-while-revalidate=60";
const PLACEHOLDER_PATH = "/catalog-product-placeholder.svg";

type RouteContext = { params: Promise<{ retailerId: string }> };
type Dependencies = {
  requireUser: typeof requireUser;
  getCatalogProductImage: typeof getCatalogProductImage;
};

const defaults: Dependencies = { requireUser, getCatalogProductImage };

export function createCatalogProductImageRouteHandlers(
  dependencies: Dependencies = defaults,
) {
  return {
    GET: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        await dependencies.requireUser();
      } catch (error) {
        return toErrorResponse(error);
      }

      const parsed = catalogRetailerIdSchema.safeParse((await context.params).retailerId);
      if (!parsed.success) {
        return toErrorResponse(new HttpError(404, "Imagem de produto não encontrada"));
      }

      try {
        const image = await dependencies.getCatalogProductImage(parsed.data);
        const body = new ArrayBuffer(image.bytes.byteLength);
        new Uint8Array(body).set(image.bytes);
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": image.contentType,
            "Content-Length": image.bytes.byteLength.toString(),
            "Cache-Control": CACHE_CONTROL,
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
          },
        });
      } catch {
        const placeholder = new URL(PLACEHOLDER_PATH, new URL(request.url).origin);
        return new Response(null, {
          status: 307,
          headers: {
            Location: placeholder.toString(),
            "Cache-Control": CACHE_CONTROL,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    },
  };
}

export const GET = createCatalogProductImageRouteHandlers().GET;

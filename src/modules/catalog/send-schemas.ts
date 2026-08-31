import "server-only";

import { z } from "zod";

import { clientRequestIdSchema } from "@/modules/messages/schemas";

import { catalogRetailerIdSchema } from "./schemas";

const requestIdentity = { clientRequestId: clientRequestIdSchema };

const productSendInputSchema = z.object({
  ...requestIdentity,
  kind: z.literal("PRODUCT"),
  retailerIds: z.tuple([catalogRetailerIdSchema]),
}).strict();

const productListSendInputSchema = z.object({
  ...requestIdentity,
  kind: z.literal("PRODUCT_LIST"),
  retailerIds: z.array(catalogRetailerIdSchema).min(1).max(30),
}).strict().superRefine((input, context) => {
  if (new Set(input.retailerIds).size !== input.retailerIds.length) {
    context.addIssue({
      code: "custom",
      path: ["retailerIds"],
      message: "Produtos repetidos não são permitidos",
    });
  }
});

const fullCatalogSendInputSchema = z.object({
  ...requestIdentity,
  kind: z.literal("CATALOG"),
}).strict();

export const catalogSendInputSchema = z.union([
  productSendInputSchema,
  productListSendInputSchema,
  fullCatalogSendInputSchema,
]);

export type CatalogSendInput = z.infer<typeof catalogSendInputSchema>;

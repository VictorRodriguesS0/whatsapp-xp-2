import { z } from "zod";

import { UserRole } from "@/generated/prisma/enums";

const passwordSchema = z.string().min(10).max(1_024);

export const userIdSchema = z.string().uuid();

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  password: passwordSchema,
  role: z.enum(UserRole),
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().toLowerCase().email().max(320).optional(),
    role: z.enum(UserRole).optional(),
    active: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "Informe ao menos um campo para atualização",
  });

export const resetUserPasswordSchema = z.object({
  password: passwordSchema,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;

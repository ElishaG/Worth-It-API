import { z } from "zod";
import { ApiError } from "./errors.js";

export function parseBody<TSchema extends z.ZodTypeAny>(schema: TSchema, body: unknown): z.infer<TSchema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, "invalid_request", "The request body is invalid.", false, {
      issues: result.error.issues,
    });
  }
  return result.data;
}

export const UuidSchema = z.string().uuid();
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
export const MoneySchema = z.object({
  amount_minor: z.number().int().min(0),
  currency: CurrencySchema,
});

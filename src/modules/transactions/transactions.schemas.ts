
import { z } from "zod";

export const createTransactionSchema = z
  .object({
    type: z.enum(["CREDIT", "DEBIT"]),
    // Accept money as a string to preserve decimal precision.
    amount: z
      .string()
      .regex(
        /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/,
        "Amount must be positive and have at most 2 decimal places.",
      )
      .refine((value) => /[1-9]/.test(value), {
        message: "Amount must be greater than zero.",
      }),
    description: z.string().trim().max(500).optional(),
    reference_id: z.string().trim().min(1).max(150),
  })
  .strict();

export const transactionAccountIdSchema = z.string().uuid();


export const transactionHistoryQuerySchema = z
  .object({
    type: z.enum(["CREDIT", "DEBIT"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();

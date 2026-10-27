
import { z } from "zod";

export const createTransferSchema = z
  .object({
    from_account_id: z.string().uuid(),
    to_account_id: z.string().uuid(),
    amount: z
      .string()
      .regex(
        /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/,
        "Amount must be positive and have at most 2 decimal places.",
      )
      .refine((value) => /[1-9]/.test(value), {
        message: "Amount must be greater than zero.",
      }),
    reference_id: z.string().trim().min(1).max(150),
    description: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
  (data) => data.from_account_id !== data.to_account_id,
  {
    message: "Source and destination accounts must be different.",
    path: ["to_account_id"],
  },
);

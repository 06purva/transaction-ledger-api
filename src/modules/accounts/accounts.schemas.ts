
import { z } from "zod";

export const createAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const accountIdSchema = z.string().uuid();

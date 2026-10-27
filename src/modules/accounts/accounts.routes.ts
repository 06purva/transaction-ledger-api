
import type { FastifyInstance } from "fastify";
import { prisma } from "../../config/prisma.js";
import {
  accountIdSchema,
  createAccountSchema,
} from "./accounts.schemas.js";

export async function accountsRoutes(app: FastifyInstance) {
  // Create an account. The client cannot set its balance or ID.
  app.post("/", async (request, reply) => {
    const parsed = createAccountSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Provide a valid account name only.",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const account = await prisma.account.create({
      data: {
        name: parsed.data.name,
      },
      select: {
        id: true,
        name: true,
        balance: true,
        createdAt: true,
      },
    });

    return reply.code(201).send({
      id: account.id,
      name: account.name,
      balance: account.balance.toFixed(2),
      createdAt: account.createdAt.toISOString(),
    });
  });

  // Get the current balance for an account.
  app.get("/:id/balance", async (request, reply) => {
    const params = request.params as { id: string };
    const parsedId = accountIdSchema.safeParse(params.id);

    if (!parsedId.success) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Account ID must be a valid UUID.",
      });
    }

    const account = await prisma.account.findUnique({
      where: { id: parsedId.data },
      select: {
        id: true,
        balance: true,
      },
    });

    if (!account) {
      return reply.code(404).send({
        error: "Not Found",
        message: "Account not found.",
      });
    }

    return reply.code(200).send({
      accountId: account.id,
      balance: account.balance.toFixed(2),
    });
  });
}

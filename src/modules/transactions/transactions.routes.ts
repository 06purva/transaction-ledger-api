
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import {
    createTransactionSchema,
    transactionAccountIdSchema,
    transactionHistoryQuerySchema,
} from "./transactions.schemas.js";

export async function transactionsRoutes(app: FastifyInstance) {

    app.get("/:id/transactions", async (request, reply) => {
        const params = request.params as { id: string };
        const parsedId = transactionAccountIdSchema.safeParse(params.id);
        const parsedQuery = transactionHistoryQuerySchema.safeParse(request.query);

        if (!parsedId.success) {
            return reply.code(400).send({
                error: "Bad Request",
                message: "Account ID must be a valid UUID.",
            });
        }

        if (!parsedQuery.success) {
            return reply.code(400).send({
                error: "Bad Request",
                message: "Invalid transaction history query.",
                details: parsedQuery.error.issues.map((issue) => ({
                    field: issue.path.join("."),
                    message: issue.message,
                })),
            });
        }

        const accountId = parsedId.data;
        const { type, page, limit } = parsedQuery.data;

        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { id: true },
        });

        if (!account) {
            return reply.code(404).send({
                error: "Not Found",
                message: "Account not found.",
            });
        }

        const where: Prisma.TransactionWhereInput = {
            accountId,
            ...(type ? { type } : {}),
        };

        const [total, transactions] = await prisma.$transaction([
            prisma.transaction.count({ where }),
            prisma.transaction.findMany({
                where,
                orderBy: [
                    { createdAt: "desc" },
                    { id: "desc" },
                ],
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    accountId: true,
                    type: true,
                    amount: true,
                    description: true,
                    referenceId: true,
                    createdAt: true,
                },
            }),
        ]);

        return reply.code(200).send({
            data: transactions.map((transaction) => ({
                id: transaction.id,
                account_id: transaction.accountId,
                type: transaction.type,
                amount: transaction.amount.toFixed(2),
                description: transaction.description,
                reference_id: transaction.referenceId,
                created_at: transaction.createdAt.toISOString(),
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    });

    app.post("/:id/transactions", async (request, reply) => {
        const params = request.params as { id: string };
        const parsedId = transactionAccountIdSchema.safeParse(params.id);
        const parsedBody = createTransactionSchema.safeParse(request.body);

        if (!parsedId.success) {
            return reply.code(400).send({
                error: "Bad Request",
                message: "Account ID must be a valid UUID.",
            });
        }

        if (!parsedBody.success) {
            return reply.code(400).send({
                error: "Bad Request",
                message: "Invalid transaction details.",
                details: parsedBody.error.issues.map((issue) => ({
                    field: issue.path.join("."),
                    message: issue.message,
                })),
            });
        }

        const accountId = parsedId.data;
        const input = parsedBody.data;
        const amount = new Prisma.Decimal(input.amount);

        const outcome = await prisma.$transaction(async (tx) => {
            // Serialize balance-changing operations for this account.
            const lockedAccounts = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM accounts
        WHERE id = ${accountId}::uuid
        FOR UPDATE
      `;

            if (lockedAccounts.length === 0) {
                return { kind: "not_found" as const };
            }

            // A reference can be used only once per account.
            const existing = await tx.transaction.findUnique({
                where: {
                    accountId_referenceId: {
                        accountId,
                        referenceId: input.reference_id,
                    },
                },
                select: { id: true },
            });

            if (existing) {
                return { kind: "duplicate" as const };
            }

            const account = await tx.account.findUniqueOrThrow({
                where: { id: accountId },
                select: { balance: true },
            });

            const nextBalance =
                input.type === "CREDIT"
                    ? account.balance.plus(amount)
                    : account.balance.minus(amount);

            if (nextBalance.isNegative()) {
                return { kind: "insufficient_funds" as const };
            }

            const maxBalance = new Prisma.Decimal("99999999999999999.99");

            if (nextBalance.greaterThan(maxBalance)) {
                return { kind: "balance_limit_exceeded" as const };
            }
            // Both changes commit together or neither change commits.
            const transaction = await tx.transaction.create({
                data: {
                    accountId,
                    type: input.type,
                    amount,
                    description: input.description,
                    referenceId: input.reference_id,
                },
                select: {
                    id: true,
                    accountId: true,
                    type: true,
                    amount: true,
                    description: true,
                    referenceId: true,
                    createdAt: true,
                },
            });

            await tx.account.update({
                where: { id: accountId },
                data: { balance: nextBalance },
            });

            return {
                kind: "success" as const,
                transaction,
                balance: nextBalance,
            };
        });

        if (outcome.kind === "not_found") {
            return reply.code(404).send({
                error: "Not Found",
                message: "Account not found.",
            });
        }

        if (outcome.kind === "duplicate") {
            return reply.code(409).send({
                error: "Conflict",
                message: "This reference ID has already been used for this account.",
            });
        }

        if (outcome.kind === "insufficient_funds") {
            return reply.code(409).send({
                error: "Insufficient Funds",
                message: "The account does not have enough balance for this debit.",
            });
        }

        if (outcome.kind === "balance_limit_exceeded") {
            return reply.code(409).send({
                error: "Conflict",
                message: "The account balance limit would be exceeded.",
            });
        }

        return reply.code(201).send({
            id: outcome.transaction.id,
            account_id: outcome.transaction.accountId,
            type: outcome.transaction.type,
            amount: outcome.transaction.amount.toFixed(2),
            description: outcome.transaction.description,
            reference_id: outcome.transaction.referenceId,
            created_at: outcome.transaction.createdAt.toISOString(),
            balance: outcome.balance.toFixed(2),
        });
    });
}


import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { createTransferSchema } from "./transfers.schemas.js";

export async function transfersRoutes(app: FastifyInstance) {
    app.post("/", async (request, reply) => {
        const parsed = createTransferSchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.code(400).send({
                error: "Validation Error",
                message: "The transfer request is invalid.",
                details: parsed.error.issues.map((issue) => ({
                    field: issue.path.join("."),
                    message: issue.message,
                })),
            });
        }

        const {
            from_account_id: fromAccountId,
            to_account_id: toAccountId,
            amount: amountString,
            reference_id: referenceId,
            description,
        } = parsed.data;

        const amount = new Prisma.Decimal(amountString);

        type TransferOutcome =
            | { status: "success"; fromBalance: Prisma.Decimal; toBalance: Prisma.Decimal; debitId: string; creditId: string }
            | { status: "not_found" }
            | { status: "duplicate" }
            | { status: "insufficient_funds" }
            | { status: "balance_limit_exceeded" };

        const outcome = await prisma.$transaction(
            async (tx): Promise<TransferOutcome> => {
                // Lock both account rows in a consistent order to reduce deadlocks.
                const accountIds = [fromAccountId, toAccountId].sort();

                for (const accountId of accountIds) {
                    await tx.$queryRaw`
            SELECT id FROM accounts
            WHERE id = ${accountId}::uuid
            FOR UPDATE
          `;
                }

                const accounts = await tx.account.findMany({
                    where: { id: { in: accountIds } },
                    select: { id: true, balance: true },
                });

                if (accounts.length !== 2) {
                    return { status: "not_found" };
                }

                // The reference must be unused on both accounts.
                const existing = await tx.transaction.findFirst({
                    where: {
                        accountId: { in: accountIds },
                        referenceId,
                    },
                    select: { id: true },
                });

                if (existing) {
                    return { status: "duplicate" };
                }

                const fromAccount = accounts.find(
                    (account) => account.id === fromAccountId,
                )!;
                const toAccount = accounts.find(
                    (account) => account.id === toAccountId,
                )!;

                if (fromAccount.balance.lessThan(amount)) {
                    return { status: "insufficient_funds" };
                }

                const fromBalance = fromAccount.balance.minus(amount);
                const toBalance = toAccount.balance.plus(amount);

                const maxBalance = new Prisma.Decimal("99999999999999999.99");

                if (toBalance.greaterThan(maxBalance)) {
                    return { status: "balance_limit_exceeded" };
                }

                // Both balance updates and both ledger entries commit together.
                await tx.account.update({
                    where: { id: fromAccountId },
                    data: { balance: fromBalance },
                });

                await tx.account.update({
                    where: { id: toAccountId },
                    data: { balance: toBalance },
                });

                const debit = await tx.transaction.create({
                    data: {
                        accountId: fromAccountId,
                        type: "DEBIT",
                        amount,
                        referenceId,
                        description: description ?? `Transfer to account ${toAccountId}`,
                    },
                    select: { id: true },
                });

                const credit = await tx.transaction.create({
                    data: {
                        accountId: toAccountId,
                        type: "CREDIT",
                        amount,
                        referenceId,
                        description: description ?? `Transfer from account ${fromAccountId}`,
                    },
                    select: { id: true },
                });

                return {
                    status: "success",
                    fromBalance,
                    toBalance,
                    debitId: debit.id,
                    creditId: credit.id,
                };
            },
        );

        if (outcome.status === "not_found") {
            return reply.code(404).send({
                error: "Not Found",
                message: "One or both accounts do not exist.",
            });
        }

        if (outcome.status === "duplicate") {
            return reply.code(409).send({
                error: "Conflict",
                message: "This reference ID has already been used on one of the accounts.",
            });
        }

        if (outcome.status === "insufficient_funds") {
            return reply.code(409).send({
                error: "Conflict",
                message: "The source account has insufficient funds.",
            });
        }

        if (outcome.status === "balance_limit_exceeded") {
            return reply.code(409).send({
                error: "Conflict",
                message: "The destination account balance limit would be exceeded.",
            });
        }

        return reply.code(201).send({
            message: "Transfer completed successfully.",
            reference_id: referenceId,
            amount: amount.toFixed(2),
            debit_transaction_id: outcome.debitId,
            credit_transaction_id: outcome.creditId,
            from_account: {
                id: fromAccountId,
                balance: outcome.fromBalance.toFixed(2),
            },
            to_account: {
                id: toAccountId,
                balance: outcome.toBalance.toFixed(2),
            },
        });
    });
}


import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

describe("POST /api/v1/transfers", () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    let fromAccountId: string;
    let toAccountId: string;

    beforeAll(async () => {
        app = await buildApp();
        await app.ready();

        const fromAccount = await prisma.account.create({
            data: { name: "Transfer Test Source" },
        });

        const toAccount = await prisma.account.create({
            data: { name: "Transfer Test Destination" },
        });

        fromAccountId = fromAccount.id;
        toAccountId = toAccount.id;

        await prisma.account.update({
            where: { id: fromAccountId },
            data: { balance: "100.00" },
        });
    });

    afterAll(async () => {
        try {
            // Preserve immutable ledger entries.
            // Remove only test accounts if the database permits it.
            // Account deletion may fail if ledger entries reference these accounts.
        } finally {
            await app.close();
            await prisma.$disconnect();
        }
    });

    it("transfers funds and creates both ledger entries", async () => {
        const referenceId = `transfer-success-${Date.now()}`;

        const response = await app.inject({
            method: "POST",
            url: "/api/v1/transfers",
            payload: {
                from_account_id: fromAccountId,
                to_account_id: toAccountId,
                amount: "25.00",
                reference_id: referenceId,
                description: "Test transfer",
            },
        });

        expect(response.statusCode).toBe(201);

        const fromAccount = await prisma.account.findUniqueOrThrow({
            where: { id: fromAccountId },
        });

        const toAccount = await prisma.account.findUniqueOrThrow({
            where: { id: toAccountId },
        });

        expect(fromAccount.balance.toFixed(2)).toBe("75.00");
        expect(toAccount.balance.toFixed(2)).toBe("25.00");

        const transactions = await prisma.transaction.findMany({
            where: {
                referenceId,
                accountId: { in: [fromAccountId, toAccountId] },
            },
        });

        expect(transactions).toHaveLength(2);
        expect(transactions.map((transaction) => transaction.type).sort()).toEqual([
            "CREDIT",
            "DEBIT",
        ]);
    });

    it("rejects insufficient funds without changing balances", async () => {
        const fromBefore = await prisma.account.findUniqueOrThrow({
            where: { id: fromAccountId },
        });
        const toBefore = await prisma.account.findUniqueOrThrow({
            where: { id: toAccountId },
        });

        const response = await app.inject({
            method: "POST",
            url: "/api/v1/transfers",
            payload: {
                from_account_id: fromAccountId,
                to_account_id: toAccountId,
                amount: "1000.00",
                reference_id: "transfer-insufficient-001",
            },
        });

        expect(response.statusCode).toBe(409);

        const fromAfter = await prisma.account.findUniqueOrThrow({
            where: { id: fromAccountId },
        });
        const toAfter = await prisma.account.findUniqueOrThrow({
            where: { id: toAccountId },
        });

        expect(fromAfter.balance.toFixed(2)).toBe(fromBefore.balance.toFixed(2));
        expect(toAfter.balance.toFixed(2)).toBe(toBefore.balance.toFixed(2));

        const entries = await prisma.transaction.count({
            where: { referenceId: "transfer-insufficient-001" },
        });

        expect(entries).toBe(0);
    });

    it("rejects transfers to the same account", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/transfers",
            payload: {
                from_account_id: fromAccountId,
                to_account_id: fromAccountId,
                amount: "10.00",
                reference_id: "transfer-same-account-001",
            },
        });

        expect(response.statusCode).toBe(400);
    });

    it("rejects a duplicate transfer reference without changing balances", async () => {
        const firstResponse = await app.inject({
            method: "POST",
            url: "/api/v1/transfers",
            payload: {
                from_account_id: fromAccountId,
                to_account_id: toAccountId,
                amount: "5.00",
                reference_id: "transfer-duplicate-001",
            },
        });

        expect(firstResponse.statusCode).toBe(201);

        const fromBefore = await prisma.account.findUniqueOrThrow({
            where: { id: fromAccountId },
        });
        const toBefore = await prisma.account.findUniqueOrThrow({
            where: { id: toAccountId },
        });

        const duplicateResponse = await app.inject({
            method: "POST",
            url: "/api/v1/transfers",
            payload: {
                from_account_id: fromAccountId,
                to_account_id: toAccountId,
                amount: "5.00",
                reference_id: "transfer-duplicate-001",
            },
        });

        expect(duplicateResponse.statusCode).toBe(409);

        const fromAfter = await prisma.account.findUniqueOrThrow({
            where: { id: fromAccountId },
        });
        const toAfter = await prisma.account.findUniqueOrThrow({
            where: { id: toAccountId },
        });

        expect(fromAfter.balance.toFixed(2)).toBe(fromBefore.balance.toFixed(2));
        expect(toAfter.balance.toFixed(2)).toBe(toBefore.balance.toFixed(2));
    });
});

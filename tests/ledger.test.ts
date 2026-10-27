
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

describe("Transaction Ledger API", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        if (
            !process.env.TEST_DATABASE_URL ||
            process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
        ) {
            throw new Error(
                "Tests must run with DATABASE_URL set to TEST_DATABASE_URL.",
            );
        }

        await prisma.$connect();
        app = await buildApp();
    });

    afterAll(async () => {
        await app?.close();
        await prisma.$disconnect();
    });

    async function createAccount(name = "Test Account") {
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/accounts",
            payload: { name },
        });

        expect(response.statusCode).toBe(201);
        return response.json() as {
            id: string;
            name: string;
            balance: string;
            createdAt: string;
        };
    }

    async function postTransaction(
        accountId: string,
        payload: {
            type: "CREDIT" | "DEBIT";
            amount: string;
            reference_id: string;
            description?: string;
        },
    ) {
        return app.inject({
            method: "POST",
            url: `/api/v1/accounts/${accountId}/transactions`,
            payload,
        });
    }

    it("creates accounts with a zero balance", async () => {
        const account = await createAccount("Zero Balance Test");

        expect(account.id).toBeTruthy();
        expect(account.balance).toBe("0.00");
        expect(account.createdAt).toBeTruthy();
    });

    it("rejects client-supplied balances", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/accounts",
            payload: { name: "Invalid Account", balance: 500 },
        });

        expect(response.statusCode).toBe(400);
    });

    it("applies credits and debits correctly", async () => {
        const account = await createAccount("Credit Debit Test");

        const credit = await postTransaction(account.id, {
            type: "CREDIT",
            amount: "100.00",
            reference_id: "credit-1",
        });
        expect(credit.statusCode).toBe(201);
        expect(credit.json().balance).toBe("100.00");

        const debit = await postTransaction(account.id, {
            type: "DEBIT",
            amount: "30.00",
            reference_id: "debit-1",
        });
        expect(debit.statusCode).toBe(201);
        expect(debit.json().balance).toBe("70.00");
    });

    it("does not apply a duplicate reference twice", async () => {
        const account = await createAccount("Duplicate Reference Test");

        const payload = {
            type: "CREDIT" as const,
            amount: "50.00",
            reference_id: "duplicate-1",
        };

        expect(
            (await postTransaction(account.id, payload)).statusCode,
        ).toBe(201);

        expect(
            (await postTransaction(account.id, payload)).statusCode,
        ).toBe(409);

        const balance = await app.inject({
            method: "GET",
            url: `/api/v1/accounts/${account.id}/balance`,
        });

        expect(balance.json().balance).toBe("50.00");
    });

    it("rejects insufficient funds without changing the balance", async () => {
        const account = await createAccount("Insufficient Funds Test");

        const debit = await postTransaction(account.id, {
            type: "DEBIT",
            amount: "10.00",
            reference_id: "too-large-1",
        });

        expect(debit.statusCode).toBe(409);

        const balance = await app.inject({
            method: "GET",
            url: `/api/v1/accounts/${account.id}/balance`,
        });

        expect(balance.json().balance).toBe("0.00");
    });

    it("filters history and returns pagination metadata", async () => {
        const account = await createAccount("History Test");

        await postTransaction(account.id, {
            type: "CREDIT",
            amount: "100.00",
            reference_id: "history-credit-1",
        });

        await postTransaction(account.id, {
            type: "DEBIT",
            amount: "20.00",
            reference_id: "history-debit-1",
        });

        const response = await app.inject({
            method: "GET",
            url: `/api/v1/accounts/${account.id}/transactions?type=CREDIT&page=1&limit=1`,
        });

        expect(response.statusCode).toBe(200);

        const body = response.json();
        expect(body.data).toHaveLength(1);
        expect(body.data[0].type).toBe("CREDIT");
        expect(body.pagination).toMatchObject({
            page: 1,
            limit: 1,
            total: 1,
            totalPages: 1,
        });
    });


    it("allows the same reference ID on different accounts", async () => {
        const accountA = await createAccount("Reference Test A");
        const accountB = await createAccount("Reference Test B");

        const payload = {
            type: "CREDIT" as const,
            amount: "25.00",
            reference_id: "shared-reference-1",
        };

        const responseA = await postTransaction(accountA.id, payload);
        const responseB = await postTransaction(accountB.id, payload);

        expect(responseA.statusCode).toBe(201);
        expect(responseB.statusCode).toBe(201);
    });

    it("prevents concurrent debits from overdrawing an account", async () => {
        const account = await createAccount("Concurrent Debit Test");

        const credit = await postTransaction(account.id, {
            type: "CREDIT",
            amount: "100.00",
            reference_id: "concurrent-credit-1",
        });

        expect(credit.statusCode).toBe(201);

        const results = await Promise.all([
            postTransaction(account.id, {
                type: "DEBIT",
                amount: "80.00",
                reference_id: "concurrent-debit-1",
            }),
            postTransaction(account.id, {
                type: "DEBIT",
                amount: "80.00",
                reference_id: "concurrent-debit-2",
            }),
        ]);

        expect(results.filter((result) => result.statusCode === 201)).toHaveLength(1);
        expect(results.filter((result) => result.statusCode === 409)).toHaveLength(1);

        const balance = await app.inject({
            method: "GET",
            url: `/api/v1/accounts/${account.id}/balance`,
        });

        expect(balance.statusCode).toBe(200);
        expect(balance.json().balance).toBe("20.00");
    });

    it("prevents ledger transactions from being updated or deleted", async () => {
        const account = await prisma.account.create({
            data: { name: "Immutability Test Account" },
        });

        const transaction = await prisma.transaction.create({
            data: {
                accountId: account.id,
                type: "CREDIT",
                amount: new Prisma.Decimal("10.00"),
                referenceId: `immutable-${crypto.randomUUID()}`,
                description: "Original description",
            },
        });

        await expect(
            prisma.$executeRaw`
      UPDATE transactions
      SET description = 'Changed description'
      WHERE id = ${transaction.id}::uuid
    `,
        ).rejects.toThrow(/immutable/i);

        await expect(
            prisma.$executeRaw`
      DELETE FROM transactions
      WHERE id = ${transaction.id}::uuid
    `,
        ).rejects.toThrow(/immutable/i);
    });
});

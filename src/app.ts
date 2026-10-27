import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyError } from "fastify";
import { accountsRoutes } from "./modules/accounts/accounts.routes.js";
import { transactionsRoutes } from "./modules/transactions/transactions.routes.js";
import { transfersRoutes } from "./modules/transfers/transfers.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
      ],
    },
    bodyLimit: 1_048_576,
    requestTimeout: 10_000,
  });

  await app.register(helmet);

  // No cross-origin browser access by default.
  // Configure explicit trusted origins if a frontend is added.
  await app.register(cors, { origin: false });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Transaction Ledger API",
        description: "Account and transaction ledger service",
        version: "1.0.0",
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  app.get("/health", async () => ({
    status: "ok",
  }));

  await app.register(accountsRoutes, {
    prefix: "/api/v1/accounts",
  });

  await app.register(transactionsRoutes, {
    prefix: "/api/v1/accounts",
  });

  await app.register(transfersRoutes, {
    prefix: "/api/v1/transfers",
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({
      error: "Not Found",
      message: "The requested resource was not found",
    });
  });


  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "Request failed");

    const statusCode =
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;

    const isInternalError = statusCode === 500;

    return reply.code(statusCode).send({
      error: isInternalError
        ? "Internal Server Error"
        : error.name,
      message: isInternalError
        ? "An unexpected error occurred"
        : error.message,
    });
  });


  return app;
}

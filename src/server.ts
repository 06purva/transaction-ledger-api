
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";

async function start() {
  const app = await buildApp();

  try {
    // Verify the database connection before accepting requests.
    await prisma.$connect();

    // Disconnect Prisma when Fastify closes.
    app.addHook("onClose", async () => {
      await prisma.$disconnect();
    });

    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    app.log.error({ err: error }, "Failed to start server");

    try {
      await app.close();
    } catch {
      // Preserve the original startup failure.
    }

    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 1;
  }
}

void start();

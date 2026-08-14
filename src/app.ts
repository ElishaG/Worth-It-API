import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { sendError } from "./lib/errors.js";
import { accountRoutes, subscriptionRoutes } from "./routes/account.js";
import { adRoutes, adWebhookRoutes } from "./routes/ads.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { referenceRoutes } from "./routes/reference.js";
import { scanRoutes } from "./routes/scans.js";
import { revenueCatWebhookRoutes } from "./routes/webhooks.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    requestIdHeader: "x-request-id",
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS.length === 0 ? false : env.CORS_ORIGINS,
    credentials: false,
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.auth?.userId ?? request.ip,
  });

  app.get("/health", async () => ({ status: "ok", service: "worth-it-api", version: "1.0.0", timestamp: new Date().toISOString() }));

  await app.register(async (v1) => {
    await v1.register(accountRoutes);
    await v1.register(subscriptionRoutes);
    await v1.register(scanRoutes);
    await v1.register(inventoryRoutes);
    await v1.register(adRoutes);
    await v1.register(referenceRoutes);
    await v1.register(revenueCatWebhookRoutes);
    await v1.register(adWebhookRoutes);
  }, { prefix: "/v1" });

  app.setErrorHandler((error, request, reply) => sendError(error, request, reply));
  return app;
}

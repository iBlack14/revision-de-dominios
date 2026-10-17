import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import type { FastifyError } from "fastify";
import { closeBrowser } from "./browser.js";
import { config } from "./config.js";
import { closeDatabase } from "./db.js";
import { runMigrations } from "./migrate.js";
import { registerRoutes } from "./routes.js";
import { startScheduler, stopScheduler } from "./scheduler.js";

const app = Fastify({ logger: true, trustProxy: true });

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: false });
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(swagger, {
  openapi: {
    info: {
      title: "WebWatch API",
      description: "API multiusuario para monitoreo web, capturas y alertas",
      version: "1.0.0"
    }
  }
});
await app.register(swaggerUi, { routePrefix: "/docs" });

app.setErrorHandler((error: FastifyError, _request, reply) => {
  app.log.error(error);
  const candidateStatus = (error as FastifyError & { statusCode?: number }).statusCode;
  const statusCode = candidateStatus && candidateStatus < 500 ? candidateStatus : 500;
  reply.code(statusCode).send({
    error: statusCode === 500 ? "Error interno" : error.message
  });
});

await runMigrations();
await registerRoutes(app);
startScheduler();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  stopScheduler();
  await app.close();
  await closeBrowser();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });

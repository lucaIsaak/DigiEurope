import Fastify from "fastify";
import type { HealthResponse } from "@digieurope/shared";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "digieurope-api",
    time: new Date().toISOString(),
  }));

  return app;
}

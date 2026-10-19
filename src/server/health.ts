import { env } from "../config/env";
import { TIMEZONE } from "../config/constants";

export interface HealthState {
  botRunning: boolean;
  botUsername?: string;
  lastUpdateProcessed?: string;
  activeDraftsCount?: number;
}

const state: HealthState = {
  botRunning: false,
};

export function updateHealthState(partial: Partial<HealthState>) {
  Object.assign(state, partial);
}

export function startHealthServer(port = env.PORT) {
  const startTime = Date.now();

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/health" || url.pathname === "/") {
        const mem = process.memoryUsage();
        const nowWIB = new Intl.DateTimeFormat("id-ID", {
          timeZone: TIMEZONE,
          dateStyle: "full",
          timeStyle: "long",
        }).format(new Date());

        const body = {
          status: "ok",
          service: "omni-bot",
          runtime: `Bun ${typeof Bun !== "undefined" ? Bun.version : process.version}`,
          serverTimeWIB: nowWIB,
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
          memory: {
            rssMB: +(mem.rss / 1024 / 1024).toFixed(2),
            heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(2),
            heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(2),
            externalMB: +(mem.external / 1024 / 1024).toFixed(2),
          },
          bot: state,
        };

        return new Response(JSON.stringify(body, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`[HealthServer] Listening on http://0.0.0.0:${server.port}`);
  return server;
}

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { connectDb, disconnectDb } from "./database/index.js";
import { runAlertScan } from "./modules/notifications/alerts.js";

async function main() {
  await connectDb();
  const app = createApp();
  const server = app.listen(env.PORT, () =>
    logger.info(`API listening on :${env.PORT}${env.API_PREFIX}`),
  );

  let timer: NodeJS.Timeout | undefined;
  if (env.ALERT_SCAN_INTERVAL_MINUTES > 0) {
    timer = setInterval(
      () =>
        runAlertScan().catch((err) =>
          logger.error({ err }, "alert scan failed"),
        ),
      env.ALERT_SCAN_INTERVAL_MINUTES * 60_000,
    );
  }

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    if (timer) clearInterval(timer);
    server.close(() => disconnectDb().finally(() => process.exit(0)));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  // Configuration errors are already human-readable and safe (no secret values).
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

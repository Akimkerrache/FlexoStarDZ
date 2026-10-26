import express, { Router, type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import mongoose from "mongoose";
import { env, corsOrigins, isProd } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/index.js";
import { buildOpenApi } from "./docs/openapi.js";

import authRoutes from "./modules/auth/auth.routes.js";
import userRoutes from "./modules/users/user.routes.js";
import clientRoutes from "./modules/clients/client.routes.js";
import printerRoutes from "./modules/printers/printer.routes.js";
import managerRoutes from "./modules/managers/manager.routes.js";
import supplierRoutes from "./modules/suppliers/supplier.routes.js";
import { catalogRouter } from "./modules/catalog/catalog.routes.js";
import machineRoutes from "./modules/machines/machine.routes.js";
import {
  optionsRouter,
  pantoneRouter,
} from "./modules/settings/technical.routes.js";
import settingsRoutes from "./modules/settings/settings.routes.js";
import quotationRoutes from "./modules/quotations/quotation.routes.js";
import orderRoutes from "./modules/orders/order.routes.js";
import plateRoutes from "./modules/photopolymer-plates/plate.routes.js";
import productionRoutes from "./modules/production/production.routes.js";
import deliveryRoutes from "./modules/deliveries/delivery.routes.js";
import invoiceRoutes from "./modules/invoices/invoice.routes.js";
import paymentRoutes from "./modules/payments/payment.routes.js";
import expenseRoutes from "./modules/expenses/expense.routes.js";
import reportRoutes from "./modules/reports/report.routes.js";
import fileRoutes from "./modules/files/file.routes.js";
import notificationRoutes from "./modules/notifications/notification.routes.js";
import auditRoutes from "./modules/audit-logs/audit.routes.js";

export const routes: { path: string; router: Router }[] = [
  { path: "/auth", router: authRoutes },
  { path: "/users", router: userRoutes },
  { path: "/clients", router: clientRoutes },
  { path: "/printers", router: printerRoutes },
  { path: "/managers", router: managerRoutes },
  { path: "/suppliers", router: supplierRoutes },
  { path: "/catalog", router: catalogRouter },
  { path: "/machines", router: machineRoutes },
  { path: "/technical-options", router: optionsRouter },
  { path: "/pantone", router: pantoneRouter },
  { path: "/settings", router: settingsRoutes },
  { path: "/quotations", router: quotationRoutes },
  { path: "/orders", router: orderRoutes },
  { path: "/plates", router: plateRoutes },
  { path: "/production", router: productionRoutes },
  { path: "/deliveries", router: deliveryRoutes },
  { path: "/invoices", router: invoiceRoutes },
  { path: "/payments", router: paymentRoutes },
  { path: "/expenses", router: expenseRoutes },
  { path: "/reports", router: reportRoutes },
  { path: "/files", router: fileRoutes },
  { path: "/notifications", router: notificationRoutes },
  { path: "/audit-logs", router: auditRoutes },
];

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  if (isProd) app.set("trust proxy", 1);

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/health" },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)),
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Idempotency-Key",
      ],
      exposedHeaders: ["Content-Disposition"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res
      .status(ready ? 200 : 503)
      .json({
        status: ready ? "ok" : "degraded",
        database: ready ? "up" : "down",
        uptime: process.uptime(),
      });
  });

  const api = Router();
  api.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX_REQUESTS * 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests, try again later",
        },
      },
    }),
  );
  for (const r of routes) api.use(r.path, r.router);
  app.use(env.API_PREFIX, api);

  const spec = buildOpenApi(routes);
  app.get(`${env.API_PREFIX}/openapi.json`, (_req, res) => res.json(spec));
  app.use(`${env.API_PREFIX}/docs`, swaggerUi.serve, swaggerUi.setup(spec));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

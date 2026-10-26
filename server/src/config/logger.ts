import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "*.password",
      "*.passwordHash",
      "*.newPassword",
      "*.currentPassword",
      "*.token",
      "*.refreshToken",
      "*.accessToken",
    ],
    censor: "[redacted]",
  },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty" } }
    : {}),
});

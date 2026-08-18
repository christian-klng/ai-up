import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Structured JSON logger (pretty in development). Shared by web and worker.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
  redact: ["req.headers.authorization", "*.password", "*.apiKey", "*.token"],
});

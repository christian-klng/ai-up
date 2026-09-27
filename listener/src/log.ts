/** Minimal JSON logger – one line per event, readable in Coolify's log view. */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

function write(level: Level, fields: Record<string, unknown>, msg: string) {
  if (ORDER[level] < min) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  debug: (fields: Record<string, unknown>, msg: string) => write("debug", fields, msg),
  info: (fields: Record<string, unknown>, msg: string) => write("info", fields, msg),
  warn: (fields: Record<string, unknown>, msg: string) => write("warn", fields, msg),
  error: (fields: Record<string, unknown>, msg: string) => write("error", fields, msg),
};

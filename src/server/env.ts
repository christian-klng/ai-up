import { z } from "zod";

/**
 * Validated process environment. Imported by web and worker.
 * Validation is lazy (first property access) so `next build` can analyze modules without a full
 * runtime environment; at runtime a missing variable fails fast on first use with a clear message.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().default("Europe/Berlin"),
  DEFAULT_LOCALE: z.enum(["de", "en"]).default("de"),
  SEED_ADMIN_EMAIL: z.string().email().optional(),

  BETTER_AUTH_SECRET: z.string().min(16),
  APP_ENCRYPTION_KEY: z.string().min(16),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("AI-Up <no-reply@example.com>"),

  WORKFLOW_CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

function load(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    return load()[prop as keyof Env];
  },
  has(_target, prop) {
    return prop in load();
  },
  ownKeys() {
    return Reflect.ownKeys(load());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const value = load()[prop as keyof Env];
    return value === undefined ? undefined : { value, enumerable: true, configurable: true, writable: false };
  },
});

export const isProd = () => env.NODE_ENV === "production";

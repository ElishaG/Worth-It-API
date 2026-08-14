import "dotenv/config";
import { z } from "zod";

const optionalUrlList = z
  .string()
  .default("")
  .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  SUPABASE_SECRET_KEY: z.string().min(10),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGINS: optionalUrlList,
  WORKER_NAME: z.string().min(1).default("worth-it-worker-local"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
  RECOGNITION_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  MARKET_PROVIDER: z.enum(["mock", "ebay"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6"),
  EBAY_CLIENT_ID: z.string().optional(),
  EBAY_CLIENT_SECRET: z.string().optional(),
  EBAY_MARKETPLACE_ID: z.string().default("EBAY_CA"),
  DEFAULT_MARKETPLACE_FEE_RATE: z.coerce.number().min(0).max(1).default(0.1325),
  DEFAULT_FIXED_FEE_AMOUNT_MINOR: z.coerce.number().int().min(0).default(0),
  DEFAULT_TARGET_MARGIN_RATE: z.coerce.number().min(0).max(0.95).default(0.2),
  REVENUECAT_WEBHOOK_AUTH: z.string().optional(),
  REVENUECAT_ENTITLEMENT_ID: z.string().default("premium"),
  AD_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

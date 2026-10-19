import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  ALLOWED_TELEGRAM_USER_ID: z.string().optional(),

  // Database (Turso / libSQL)
  TURSO_DATABASE_URL: z.string().default("file:data/omni.db"),
  TURSO_AUTH_TOKEN: z.string().optional(),

  // Groq multi-key (comma separated)
  GROQ_API_KEYS: z.string().optional(),
  GROQ_PRIMARY_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GROQ_FALLBACK_MODEL: z.string().default("llama-3.1-8b-instant"),

  // Google Calendar Service Account
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env;
try {
  parsedEnv = envSchema.parse(process.env);
} catch (err) {
  console.error("❌ Environment validation error:", err);
  throw err;
}

export const env = parsedEnv;

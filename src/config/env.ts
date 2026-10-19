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

  // Groq multi-key (comma separated or individual keys)
  GROQ_API_KEYS: z.string().optional(),
  GROQ_API_KEY_PRIMARY: z.string().optional(),
  GROQ_API_KEY_SECONDARY: z.string().optional(),
  GROQ_API_KEY_1: z.string().optional(),
  GROQ_API_KEY_2: z.string().optional(),
  GROQ_PRIMARY_MODEL: z.string().default("qwen/qwen3.8-27b"),
  GROQ_FALLBACK_MODEL: z.string().default("openai/gpt-oss-120b"),

  // Ollama Cloud (Second-tier LLM fallback)
  OLLAMA_API_KEY_1: z.string().optional(),
  OLLAMA_API_KEY_2: z.string().optional(),
  OLLAMA_MODEL: z.string().default("gpt-oss:120b-cloud"),

  // Google Calendar Service Account
  GOOGLE_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),
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

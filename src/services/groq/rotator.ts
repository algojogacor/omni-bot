import Groq from "groq-sdk";

export class QuotaExhaustedError extends Error {
  constructor(message = "Seluruh kuota API key dan model Groq telah habis hari ini.") {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

export interface RotatorOptions {
  apiKeys: string[];
  primaryModel?: string;
  fallbackModel?: string;
  cooldownSeconds?: number;
}

export interface ClientCandidate {
  client: Groq;
  key: string;
  model: string;
}

export class GroqRotator {
  private keys: string[];
  private primaryModel: string;
  private fallbackModel: string;
  private cooldownMs: number;
  private currentIndex = 0;
  private clients: Map<string, Groq> = new Map();

  // Cooldown timestamps per key per model
  private primaryCooldowns: Map<string, number> = new Map();
  private fallbackCooldowns: Map<string, number> = new Map();

  constructor(options: RotatorOptions) {
    this.keys = (options.apiKeys || []).map((k) => k.trim()).filter((k) => k.length > 0);
    this.primaryModel = options.primaryModel || "qwen/qwen3.8-27b";
    this.fallbackModel = options.fallbackModel || "openai/gpt-oss-120b";
    this.cooldownMs = (options.cooldownSeconds ?? 60) * 1000;

    for (const key of this.keys) {
      this.clients.set(key, new Groq({ apiKey: key }));
    }
  }

  getKeyCount(): number {
    return this.keys.length;
  }

  addKey(key: string) {
    const trimmed = key.trim();
    if (trimmed && !this.keys.includes(trimmed)) {
      this.keys.push(trimmed);
      this.clients.set(trimmed, new Groq({ apiKey: trimmed }));
    }
  }

  markKeyRateLimited(key: string, isFallback = false) {
    const until = Date.now() + this.cooldownMs;
    if (isFallback) {
      this.fallbackCooldowns.set(key, until);
      console.warn(`[GroqRotator] Key ${key.slice(0, 8)}... marked rate-limited on fallback model until ${new Date(until).toLocaleTimeString()}`);
    } else {
      this.primaryCooldowns.set(key, until);
      console.warn(`[GroqRotator] Key ${key.slice(0, 8)}... marked rate-limited on primary model until ${new Date(until).toLocaleTimeString()}`);
    }
  }

  /**
   * Retrieves the next available key and model candidate
   */
  getNextCandidate(): ClientCandidate {
    if (this.keys.length === 0) {
      throw new QuotaExhaustedError("Tidak ada API key Groq yang dikonfigurasi.");
    }

    const now = Date.now();

    // 1. Try to find a key available on primary model
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const key = this.keys[idx]!;
      const cooldownUntil = this.primaryCooldowns.get(key) || 0;

      if (now >= cooldownUntil) {
        this.currentIndex = (idx + 1) % this.keys.length;
        const client = this.clients.get(key) || new Groq({ apiKey: key });
        return { client, key, model: this.primaryModel };
      }
    }

    // 2. All keys on primary model are cooling down. Try fallback model
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const key = this.keys[idx]!;
      const cooldownUntil = this.fallbackCooldowns.get(key) || 0;

      if (now >= cooldownUntil) {
        this.currentIndex = (idx + 1) % this.keys.length;
        const client = this.clients.get(key) || new Groq({ apiKey: key });
        return { client, key, model: this.fallbackModel };
      }
    }

    // 3. Both models on all keys are exhausted
    throw new QuotaExhaustedError();
  }

  /**
   * Executes an LLM call with automatic rotation and retry across keys & models
   */
  async executeWithRetry<T>(
    operation: (candidate: ClientCandidate) => Promise<T>
  ): Promise<T> {
    const maxAttempts = Math.max(1, this.keys.length * 2);
    let lastError: any = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let candidate: ClientCandidate;
      try {
        candidate = this.getNextCandidate();
      } catch (err) {
        if (err instanceof QuotaExhaustedError) throw err;
        throw err;
      }

      try {
        return await operation(candidate);
      } catch (err: any) {
        lastError = err;
        const status = err?.status || err?.statusCode || err?.response?.status;
        const msg = String(err?.message || "").toLowerCase();

        // Check if rate limited or quota exceeded (429 or 413)
        if (status === 429 || msg.includes("rate limit") || msg.includes("quota")) {
          const isFallback = candidate.model === this.fallbackModel;
          this.markKeyRateLimited(candidate.key, isFallback);
          continue; // retry with next candidate
        }

        // Non-rate limit error (e.g. invalid request, 400), don't spin in loop
        throw err;
      }
    }

    throw lastError || new QuotaExhaustedError();
  }
}

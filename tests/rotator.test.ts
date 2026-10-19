import { describe, expect, test } from "bun:test";
import { GroqRotator, QuotaExhaustedError } from "../src/services/groq/rotator";

describe("Groq Key Rotator & Fallback Engine", () => {
  test("initializes keys and rotates round-robin", () => {
    const rotator = new GroqRotator({
      apiKeys: ["key_A", "key_B", "key_C"],
      primaryModel: "primary-model",
      fallbackModel: "fallback-model",
    });

    expect(rotator.getKeyCount()).toBe(3);
    const first = rotator.getNextCandidate();
    const second = rotator.getNextCandidate();
    const third = rotator.getNextCandidate();
    const fourth = rotator.getNextCandidate();

    expect(first.key).toBe("key_A");
    expect(second.key).toBe("key_B");
    expect(third.key).toBe("key_C");
    expect(fourth.key).toBe("key_A"); // looped round-robin
    expect(first.model).toBe("primary-model");
  });

  test("puts rate-limited key into cooldown and advances", () => {
    const rotator = new GroqRotator({
      apiKeys: ["key_A", "key_B"],
      primaryModel: "primary-model",
      fallbackModel: "fallback-model",
      cooldownSeconds: 10,
    });

    rotator.markKeyRateLimited("key_A");
    // Next candidate should be key_B
    const next = rotator.getNextCandidate();
    expect(next.key).toBe("key_B");

    // Calling again should still be key_B because key_A is in cooldown
    const nextAgain = rotator.getNextCandidate();
    expect(nextAgain.key).toBe("key_B");
  });

  test("falls back to secondary model when all keys on primary are in cooldown", () => {
    const rotator = new GroqRotator({
      apiKeys: ["key_A", "key_B"],
      primaryModel: "primary-model",
      fallbackModel: "fallback-model",
      cooldownSeconds: 60,
    });

    rotator.markKeyRateLimited("key_A");
    rotator.markKeyRateLimited("key_B");

    // Both keys limited on primary model -> switches to fallbackModel!
    const candidate = rotator.getNextCandidate();
    expect(candidate.model).toBe("fallback-model");
  });

  test("throws QuotaExhaustedError when all keys and models are exhausted", () => {
    const rotator = new GroqRotator({
      apiKeys: ["key_A"],
      primaryModel: "primary-model",
      fallbackModel: "fallback-model",
      cooldownSeconds: 60,
    });

    rotator.markKeyRateLimited("key_A"); // primary exhausted
    rotator.markKeyRateLimited("key_A", true); // fallback exhausted too

    expect(() => {
      rotator.getNextCandidate();
    }).toThrow(QuotaExhaustedError);
  });
});

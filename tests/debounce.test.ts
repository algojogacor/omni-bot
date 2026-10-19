import { describe, expect, test } from "bun:test";
import { DebounceQueue } from "../src/bot/middlewares/debounce";

describe("Telegram Forward Message Debounce Queue", () => {
  test("combines multiple messages arriving within delay", async () => {
    let outputText = "";
    let callCount = 0;

    const queue = new DebounceQueue({
      delayMs: 100, // short delay for test
      onFlush: async (text) => {
        outputText = text;
        callCount++;
      },
    });

    queue.push("Chunk 1\n");
    await Bun.sleep(30);
    queue.push("Chunk 2\n");
    await Bun.sleep(30);
    queue.push("Chunk 3");

    // Before delay expires
    expect(callCount).toBe(0);

    // Wait for delay to expire
    await Bun.sleep(150);

    expect(callCount).toBe(1);
    expect(outputText).toBe("Chunk 1\n\nChunk 2\n\nChunk 3");
  });
});

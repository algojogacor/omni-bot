import { DEBOUNCE_WAIT_MS } from "../../config/constants";

export interface DebounceOptions {
  delayMs?: number;
  onFlush: (combinedText: string) => Promise<void>;
}

export class DebounceQueue {
  private chunks: string[] = [];
  private timer: any = null;
  private delayMs: number;
  private onFlush: (combinedText: string) => Promise<void>;

  constructor(options: DebounceOptions) {
    this.delayMs = options.delayMs ?? DEBOUNCE_WAIT_MS;
    this.onFlush = options.onFlush;
  }

  push(text: string) {
    this.chunks.push(text);

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(async () => {
      const combined = this.chunks.join("\n").trim();
      this.chunks = [];
      this.timer = null;
      if (combined.length > 0) {
        try {
          await this.onFlush(combined);
        } catch (err) {
          console.error("[DebounceQueue] Error in onFlush handler:", err);
        }
      }
    }, this.delayMs);
  }

  flushNow(): Promise<void> | void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const combined = this.chunks.join("\n").trim();
    this.chunks = [];
    if (combined.length > 0) {
      return this.onFlush(combined);
    }
  }
}

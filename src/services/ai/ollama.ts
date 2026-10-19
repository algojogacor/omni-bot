import { env } from "../../config/env";
import { buildSystemPrompt } from "../groq/tools";

export interface OllamaResult {
  function: "record_transaction" | "transfer_wallet" | "query_recap" | "summarize_group_log" | "unknown";
  arguments: any;
}

let lastOllamaSlot = 1;

export async function callOllamaFallback(userText: string): Promise<OllamaResult | null> {
  const key1 = env.OLLAMA_API_KEY_1;
  const key2 = env.OLLAMA_API_KEY_2;
  const keys = [key1, key2].filter(Boolean) as string[];

  if (keys.length === 0) return null;

  // Alternate keys
  const apiKey = keys[lastOllamaSlot % keys.length]!;
  lastOllamaSlot++;

  const system = buildSystemPrompt() + `\n\nOUTPUT FORMAT INSTRUCTION:
You MUST respond with a single valid JSON object representing the action to take:
1. For expense/income:
   {"function": "record_transaction", "arguments": {"type": "expense"|"income", "amount": number, "wallet": "Tunai"|"GoPay"|"Mandiri"|null, "category": string, "description": string, "transaction_date": "YYYY-MM-DD"}}
2. For transfer:
   {"function": "transfer_wallet", "arguments": {"from_wallet": string, "to_wallet": string, "amount": number, "description": string, "transaction_date": "YYYY-MM-DD"}}
3. For balance/recap query:
   {"function": "query_recap", "arguments": {"period": "today"|"this_week"|"this_month"|"last_month"|null, "start_date": "YYYY-MM-DD"|null, "end_date": "YYYY-MM-DD"|null, "category": string|null, "keyword": string|null, "ask_balance": boolean}}
4. For group log summary:
   {"function": "summarize_group_log", "arguments": {"tldr": string, "arya_tasks": string[], "other_tasks": [{"person": string, "task": string}], "events": [{"title": string, "start_time": string, "end_time": string, "description": string}]}}

Do NOT include any markdown code fences or conversational text outside the JSON.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL || "gpt-oss:120b-cloud",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText },
        ],
        format: "json",
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[OllamaFallback] HTTP error ${res.status}: ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    const content = data?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    if (parsed.function && parsed.arguments) {
      return parsed as OllamaResult;
    }

    return null;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("[OllamaFallback] Error during Ollama call:", err);
    return null;
  }
}

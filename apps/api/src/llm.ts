/**
 * The one place that talks to a language model for the agents. OpenRouter speaks the OpenAI chat format and
 * routes to many models, so the model is a setting. Default: a very cheap one. Set OPENROUTER_MODEL to change it
 * (a free model such as one ending in ":free" works too, with rate limits).
 *
 * Every call returns parsed JSON or null. Callers must treat null as "ask a person", never as a guess.
 */
export const llmAvailable = () => Boolean(process.env.OPENROUTER_API_KEY);
export const llmModel = () => process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-lite";

export type LlmPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "file"; file: { filename: string; file_data: string } };

/** A document as a message part: a PDF as a file, an image as an image. */
export function documentPart(content: Buffer, mimeType: string, filename = "document"): LlmPart {
  const url = `data:${mimeType};base64,${content.toString("base64")}`;
  return mimeType === "application/pdf" ? { type: "file", file: { filename, file_data: url } } : { type: "image_url", image_url: { url } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chatJson(system: string, user: string | LlmPart[], fetchImpl: typeof fetch = fetch, maxTokens = 800): Promise<unknown | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const request = () =>
    fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Application agents" },
      body: JSON.stringify({
        model: llmModel(),
        max_tokens: maxTokens,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(40_000),
    });
  try {
    // Free models are often rate-limited for a moment: retry up to four times with a growing pause, then give up (the case goes to a person).
    let res = await request();
    for (let i = 1; i <= 4 && (res.status === 429 || res.status >= 500); i++) {
      await sleep(Number(process.env.LLM_RETRY_MS ?? 3000) * i);
      res = await request();
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "";
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

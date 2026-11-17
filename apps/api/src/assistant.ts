import { KB_FALLBACK, KNOWLEDGE, answerFromKnowledge, type Bilingual, type Lang } from "@digieurope/shared";

export interface AssistantAnswer {
  answer: string;
  sources: { label: string; url: string }[];
  mode: "retrieval" | "live";
  matched: boolean;
}

export function retrieve(question: string, lang: Lang): AssistantAnswer {
  const hit = answerFromKnowledge(question);
  if (!hit) return { answer: KB_FALLBACK.answer[lang], sources: [KB_FALLBACK.source], mode: "retrieval", matched: false };
  return { answer: hit.answer[lang], sources: [hit.source], mode: "retrieval", matched: true };
}

export const liveAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Optional live answer. The model may only use the curated entries below and must name the entry ids it used;
 * sources are taken from those entries, never from the model's own text. Any failure falls back to retrieval.
 */
export async function askLive(question: string, lang: Lang, fetchImpl: typeof fetch = fetch): Promise<AssistantAnswer> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return retrieve(question, lang);
  const context = KNOWLEDGE.map((e) => `[${e.id}] ${e.question.en}: ${e.answer.en}`).join("\n");
  const system =
    "You answer general questions about Germany's Auslands-BAföG using ONLY the numbered facts provided. " +
    "Never state or imply a decision about the user's own case; amounts are estimates. If the facts do not answer the question, say so. " +
    `Reply with JSON only: {"answer": string in ${lang === "de" ? "German" : "English"}, "entryIds": string[] of the fact ids you used}.\n\nFACTS:\n${context}`;
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5", max_tokens: 500, system, messages: [{ role: "user", content: question.slice(0, 500) }] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { answer?: string; entryIds?: string[] };
    const entries = KNOWLEDGE.filter((e) => parsed.entryIds?.includes(e.id));
    if (!parsed.answer || entries.length === 0) return retrieve(question, lang);
    return { answer: parsed.answer, sources: entries.map((e) => e.source), mode: "live", matched: true };
  } catch {
    return retrieve(question, lang);
  }
}

export type { Bilingual };

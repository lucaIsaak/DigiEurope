import { draftToProcess, generationPrompt, parseDraft, simulateDraft, type GeneratedProcess } from "@digieurope/shared";

export type GenerateMode = "simulated" | "live";

export interface GenerateResult extends GeneratedProcess {
  /** Who wrote the draft. "simulated" is the keyword writer; "live" is a model. */
  mode: GenerateMode;
  /** Set when live was asked for but the simulated writer answered, and why. */
  fellBack?: string;
}

export const liveProcessAiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const processAiModel = () => process.env.PROCESS_AI_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

/**
 * Optional live writer. The model only proposes a draft in the vocabulary of the builder; the draft then goes through the
 * same clean-up and validation as the simulated one, so a model can never put an unknown step or rule on the canvas.
 * If the first answer has problems the builder would report, the model gets them once and may correct itself.
 * Any failure falls back to the simulated writer.
 */
export async function generateLive(description: string, fetchImpl: typeof fetch = fetch): Promise<GenerateResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ...draftToProcess(simulateDraft(description)), mode: "simulated", fellBack: "No ANTHROPIC_API_KEY is set." };
  const system = generationPrompt();
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: description.slice(0, 4000) }];
  const ask = async (): Promise<string> => {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: processAiModel(), max_tokens: 4000, system, messages }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) throw new Error(`The AI service answered with status ${res.status}.`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    return body.content?.find((c) => c.type === "text")?.text ?? "";
  };
  try {
    let text = await ask();
    let draft = parseDraft(text);
    if (!draft) throw new Error("The answer was not a usable process.");
    let result = draftToProcess(draft);
    if (result.issues.length) {
      messages.push({ role: "assistant", content: text }, { role: "user", content: `The builder reports these problems. Fix them and reply with the whole JSON again:\n${result.issues.map((i) => `- ${i.message.en}`).join("\n")}` });
      text = await ask();
      draft = parseDraft(text);
      if (draft) result = draftToProcess(draft);
    }
    return { ...result, mode: "live" };
  } catch (e) {
    return { ...draftToProcess(simulateDraft(description)), mode: "simulated", fellBack: e instanceof Error ? e.message : "The AI service could not be reached." };
  }
}

export async function generateProcessFrom(description: string, mode: GenerateMode, fetchImpl?: typeof fetch): Promise<GenerateResult> {
  if (mode === "live") return generateLive(description, fetchImpl);
  return { ...draftToProcess(simulateDraft(description)), mode: "simulated" };
}

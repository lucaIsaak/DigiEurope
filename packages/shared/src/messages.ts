import type { Bilingual } from "./types.js";

/**
 * A message to an applicant that is written, translated and approved once, and then used by steps of processes.
 * It has parameters ({unclear}, {open_items} …); the step says what goes into each of them, so a template does not
 * need to know the steps of any process. Greeting and sign-off are added when the message is sent.
 */
export interface MessageTemplate {
  id: string;
  name: string;
  /** When to use it. */
  purpose: string;
  subject: Bilingual;
  body: Bilingual;
  version: number;
}

/** Always available in a template without being set by a step. */
export const GLOBAL_PARAMS = ["name", "reference", "amount"];

/** The parameters of a template: every {word} in its texts that is not one of the basics. */
export function paramsOf(t: { subject: Bilingual; body: Bilingual }): string[] {
  const found = new Set<string>();
  for (const text of [t.subject.de, t.subject.en, t.body.de, t.body.en]) for (const m of text.matchAll(/\{([a-z_]+)\}/g)) if (!GLOBAL_PARAMS.includes(m[1]!)) found.add(m[1]!);
  return [...found];
}

const b = (de: string, en: string): Bilingual => ({ de, en });

/** The templates an office starts with. */
export const DEFAULT_MESSAGE_TEMPLATES: Omit<MessageTemplate, "version">[] = [
  {
    id: "msg-approved",
    name: "Approval notice",
    purpose: "Tells the applicant that the application was approved, with the explanation the caseworker wrote.",
    subject: b("Ihr Antrag {reference} wurde bewilligt", "Your application {reference} has been approved"),
    body: b("Ihr Antrag wurde bewilligt: {amount} pro Monat.\n\n{explanation}\n\nDer Bescheid folgt.", "Your application has been approved: {amount} per month.\n\n{explanation}\n\nThe decision notice follows."),
  },
  {
    id: "msg-rejected",
    name: "Rejection notice",
    purpose: "Tells the applicant that the application was not approved, with the explanation the caseworker wrote.",
    subject: b("Entscheidung zu Ihrem Antrag {reference}", "Decision on your application {reference}"),
    body: b("Ihr Antrag wurde leider nicht bewilligt.\n\n{explanation}\n\nDer Bescheid folgt.", "Your application was not approved.\n\n{explanation}\n\nThe decision notice follows."),
  },
  {
    id: "msg-question",
    name: "Question about unclear documents",
    purpose: "Asks the applicant about documents or fields that could not be read reliably.",
    subject: b("Rückfrage zu Ihrem Antrag {reference}", "Question about your application {reference}"),
    body: b(
      "vielen Dank für Ihren Antrag {reference}. Bevor wir ihn bearbeiten können, brauchen wir noch Folgendes:\n\n{unclear}\n\nDetails:\n{details}\n\nLaden Sie die Unterlagen einfach in Ihrem Antrag hoch. Sobald alles vollständig ist, geht Ihr Antrag direkt in die Prüfung.",
      "thank you for your application {reference}. Before we can process it we still need the following:\n\n{unclear}\n\nDetails:\n{details}\n\nSimply upload the documents in your application. As soon as everything is complete, your application goes straight to review.",
    ),
  },
  {
    id: "msg-missing",
    name: "What is still missing",
    purpose: "Lists what blocks the application, after the check.",
    subject: b("Ihr Antrag {reference}: Das fehlt noch", "Your application {reference}: what is still missing"),
    body: b(
      "vielen Dank für Ihren Antrag {reference}. Bevor wir ihn bearbeiten können, brauchen wir noch Folgendes:\n\n{open_items}\n\nLaden Sie die Unterlagen einfach in Ihrem Antrag hoch.",
      "thank you for your application {reference}. Before we can process it we still need the following:\n\n{open_items}\n\nSimply upload the documents in your application.",
    ),
  },
  {
    id: "msg-reminder",
    name: "Reminder",
    purpose: "Reminds the applicant that the office is still waiting for something.",
    subject: b("Erinnerung zu Ihrem Antrag {reference}", "Reminder about your application {reference}"),
    body: b(
      "wir haben noch keine Rückmeldung zu Ihrem Antrag {reference} erhalten. Wir warten noch auf:\n\n{pending}\n\nBitte laden Sie die Unterlagen hoch, damit wir weitermachen können.",
      "we have not heard back about your application {reference} yet. We are still waiting for:\n\n{pending}\n\nPlease upload the documents so that we can carry on.",
    ),
  },
];

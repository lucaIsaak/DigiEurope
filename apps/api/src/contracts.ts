import { upstreamOutputs, type Bilingual, type DocumentTemplate, type ProcessDef } from "@digieurope/shared";

/**
 * Data contracts of the connectors: what each action needs from the case, and where that can come from.
 * Prototype values: they describe what such an action would plausibly need, not a real system's interface.
 * The watcher uses them for lineage: every item a connector step needs must be provided earlier in the process.
 */

export interface DataItem {
  id: string;
  label: Bilingual;
  /**
   * system: the platform always has it (reference, status, documents).
   * application: entered when applying (name, stay).
   * decision: set by a person deciding, so a "caseworker decides" step must come before.
   * collected: must be asked for: a template field or a question of the process whose key or label matches.
   */
  source: "system" | "application" | "decision" | "collected";
  matches?: RegExp;
}

const b = (de: string, en: string): Bilingual => ({ de, en });

export const DATA_ITEMS: DataItem[] = [
  { id: "case.reference", label: b("Aktenzeichen", "Case reference"), source: "system" },
  { id: "case.status", label: b("Status des Antrags", "Case status"), source: "system" },
  { id: "case.documents", label: b("Dokumente des Antrags", "Case documents"), source: "system" },
  { id: "student.name", label: b("Name der Person", "Student name"), source: "application" },
  { id: "stay.type", label: b("Art des Aufenthalts", "Type of stay"), source: "application" },
  { id: "decision.outcome", label: b("Entscheidung", "Decision"), source: "decision" },
  { id: "decision.amount", label: b("Bewilligter Betrag", "Amount granted"), source: "decision" },
  { id: "bank.iban", label: b("IBAN für die Auszahlung", "IBAN for the payout"), source: "collected", matches: /iban|bankverbindung|bank account|kontonummer/i },
];

/** What each connector action needs, by connector id and action id. */
export const CONNECTOR_CONTRACTS: Record<string, Record<string, string[]>> = {
  case_software: {
    create_case: ["case.reference", "student.name", "stay.type"],
    update_status: ["case.reference", "case.status"],
    attach_documents: ["case.reference", "case.documents"],
  },
  efile: { archive_case: ["case.reference", "case.documents", "decision.outcome"] },
  payment: {
    create_payment_order: ["case.reference", "student.name", "decision.amount", "bank.iban"],
    cancel_payment: ["case.reference"],
  },
  portal: { send_status: ["case.reference", "case.status"], close_request: ["case.reference"] },
};

export const dataItem = (id: string) => DATA_ITEMS.find((d) => d.id === id);

/** Where a collected item comes from in this process: a field of a required template, or one of the process's questions. */
export function collectedFrom(item: DataItem, def: ProcessDef, templates: DocumentTemplate[]): { template?: string; field?: string; question?: string } | null {
  if (!item.matches) return null;
  for (const i of def.inputs) {
    if (i.type === "document") {
      const t = templates.find((x) => x.id === i.ref);
      const f = t?.fields.find((x) => item.matches!.test(x.key) || item.matches!.test(x.label));
      if (t && f) return { template: t.id, field: f.key };
    } else if (item.matches.test(i.ref) || (i.question && (item.matches.test(i.question.label.de) || item.matches.test(i.question.label.en)))) {
      return { question: i.ref };
    }
  }
  return null;
}

/** Items a connector step needs that nothing earlier in the process provides. */
export function missingInputs(def: ProcessDef, nodeId: string, templates: DocumentTemplate[]): DataItem[] {
  const n = def.nodes.find((x) => x.id === nodeId);
  if (!n || n.kind !== "connector") return [];
  const needs = CONNECTOR_CONTRACTS[String(n.config.system)]?.[String(n.config.action)] ?? [];
  const up = upstreamOutputs(def, nodeId);
  const decided = up.some((u) => u.kind === "human_task");
  return needs
    .map(dataItem)
    .filter((d): d is DataItem => Boolean(d))
    .filter((d) => (d.source === "decision" ? !decided : d.source === "collected" ? !collectedFrom(d, def, templates) : false));
}

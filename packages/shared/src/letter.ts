import { AMOUNTS, monthlyNeed, parentContribution } from "./estimate.js";
import type { Bilingual } from "./types.js";

/** What the reader finds on a decision letter. */
export interface LetterFields {
  name: string;
  period_from: string;
  period_to: string;
  country: string;
  need_monthly: number;
  parent_income_year: number;
  parent_net_monthly: number;
  parents_married: boolean;
  siblings_in_education: number;
  parent_contribution: number;
  grant_monthly: number;
  tuition_supplement: number;
  tuition_months: number;
  travel_allowance: number;
}

export interface LetterScenario {
  /** Relative change of the parents' income in the next reference year, in percent. */
  incomeChangePercent: number;
  /** Does the next period include another stay abroad with tuition fees? */
  tuitionAgain: boolean;
  /** Additional siblings in education next period. */
  extraSiblings: number;
}

export type Verdict = "likely_ok" | "likely_reduced" | "likely_rejected";

export interface LetterAnalysis {
  explain: { label: Bilingual; amount: number; kind: "plus" | "minus" | "total" }[];
  next: {
    verdict: Verdict;
    monthly: number;
    tuition: number;
    reasons: { text: Bilingual; source?: { label: string; url: string } }[];
    levers: Bilingual[];
  };
}

const G = "https://www.gesetze-im-internet.de";

export function analyzeLetter(l: LetterFields, s: LetterScenario): LetterAnalysis {
  const explain: LetterAnalysis["explain"] = [
    { label: { de: "Ihr monatlicher Bedarf (inkl. Versicherung und Auslandszuschlag)", en: "Your monthly need (incl. insurance and abroad surcharge)" }, amount: l.need_monthly, kind: "plus" },
    { label: { de: "Davon angerechnetes Einkommen Ihrer Eltern", en: "Minus: your parents' income that counts" }, amount: -l.parent_contribution, kind: "minus" },
    { label: { de: "Monatliche Förderung laut Bescheid", en: "Monthly funding on your letter" }, amount: l.grant_monthly, kind: "total" },
  ];
  if (l.tuition_supplement > 0) {
    explain.push({
      label: { de: `Einmaliger Zuschuss zu Studiengebühren (für höchstens ${l.tuition_months} Monate)`, en: `One-off tuition supplement (for at most ${l.tuition_months} months)` },
      amount: l.tuition_supplement,
      kind: "plus",
    });
  }

  const netNext = Math.round(l.parent_net_monthly * (1 + s.incomeChangePercent / 100));
  const siblings = l.siblings_in_education + s.extraSiblings;
  const contribution = parentContribution({ netMonthly: netNext, married: l.parents_married, siblings });
  const need = l.need_monthly || monthlyNeed(l.country).total;
  let monthly = Math.max(0, need - contribution);
  if (monthly < 10) monthly = 0;

  const reasons: LetterAnalysis["next"]["reasons"] = [];
  const levers: Bilingual[] = [];

  if (monthly === 0) {
    reasons.push({
      text: {
        de: `Mit etwa ${netNext} € Nettoeinkommen der Eltern pro Monat wäre der angerechnete Betrag (${contribution} €) so hoch wie Ihr Bedarf (${need} €). Der Antrag würde voraussichtlich wegen Einkommens abgelehnt.`,
        en: `With roughly ${netNext} € net monthly parental income the counted amount (${contribution} €) would be as high as your need (${need} €). The application would likely be rejected because of income.`,
      },
      source: { label: "§ 25 BAföG", url: `${G}/baf_g/__25.html` },
    });
  } else if (monthly < l.grant_monthly - 10) {
    reasons.push({
      text: {
        de: `Das Einkommen der Eltern wird für das nächste Bezugsjahr neu betrachtet. Bei ${s.incomeChangePercent >= 0 ? "+" : ""}${s.incomeChangePercent} % sinkt Ihre Förderung voraussichtlich von ${l.grant_monthly} € auf etwa ${monthly} €.`,
        en: `Your parents' income is looked at again for the next reference year. At ${s.incomeChangePercent >= 0 ? "+" : ""}${s.incomeChangePercent} % your funding would likely drop from ${l.grant_monthly} € to about ${monthly} €.`,
      },
      source: { label: "§ 25 BAföG", url: `${G}/baf_g/__25.html` },
    });
  }

  let tuition = 0;
  if (l.tuition_supplement > 0 && l.tuition_months >= 12) {
    reasons.push({
      text: {
        de: `Der Zuschuss zu Studiengebühren wird höchstens für ein Jahr gezahlt. Er endet mit diesem Bescheid (${l.tuition_supplement} €). ${s.tuitionAgain ? "Gebühren im nächsten Zeitraum müssten Sie selbst tragen." : ""}`,
        en: `The tuition supplement is paid for one year at most. It ends with this letter (${l.tuition_supplement} €). ${s.tuitionAgain ? "You would have to pay fees in the next period yourself." : ""}`,
      },
      source: { label: "BAföG-AuslandszuschlagsV § 3", url: `${G}/baf_gzuschlagsv/BJNR009350986.html` },
    });
    levers.push({
      de: "Studiengebühren im nächsten Zeitraum vermeiden: Erlass, Ermäßigung oder ein Programm ohne Gebühren (z. B. Austauschplatz) anfragen.",
      en: "Avoid fees in the next period: ask for a waiver, a reduction, or a place without fees (for example an exchange place).",
    });
  } else if (s.tuitionAgain) {
    tuition = Math.min(l.tuition_supplement, AMOUNTS.tuitionCap);
  }

  if (monthly === 0 || monthly < l.grant_monthly - 10) {
    if (s.incomeChangePercent >= 0) {
      levers.push({
        de: "Sind die Einkünfte Ihrer Eltern jetzt voraussichtlich wesentlich niedriger als im Bezugsjahr, kann ein Antrag auf Aktualisierung gestellt werden (§ 24 Abs. 3 BAföG, Nachweise nötig).",
        en: "If your parents' income is now expected to be significantly lower than in the reference year, an update application can be made (§ 24 para. 3 BAföG, proof needed).",
      });
    }
    if (s.extraSiblings === 0) {
      levers.push({
        de: `Geschwister in einer förderfähigen Ausbildung erhöhen den Freibetrag um ${AMOUNTS.allowancePerChild} € je Person. Melden Sie sie im Elternformular an.`,
        en: `Siblings in funded education raise the allowance by ${AMOUNTS.allowancePerChild} € each. Report them in the parents' form.`,
      });
    }
    levers.push({
      de: "Stellen Sie den Folgeantrag früh: Förderung gibt es frühestens ab dem Monat der Antragstellung.",
      en: "File the follow-up application early: funding starts at the earliest in the month you apply.",
    });
  }

  const verdict: Verdict = monthly === 0 ? "likely_rejected" : monthly < l.grant_monthly - 10 || (l.tuition_supplement > 0 && l.tuition_months >= 12 && s.tuitionAgain) ? "likely_reduced" : "likely_ok";
  if (verdict === "likely_ok") {
    reasons.push({
      text: { de: "Bei gleichbleibenden Verhältnissen ändert sich Ihre Förderung voraussichtlich kaum.", en: "If nothing else changes, your funding is likely to stay about the same." },
    });
  }
  return { explain, next: { verdict, monthly, tuition, reasons, levers } };
}

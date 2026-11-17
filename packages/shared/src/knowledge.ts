import type { Bilingual } from "./types.js";

export interface KbEntry {
  id: string;
  keywords: string[];
  question: Bilingual;
  answer: Bilingual;
  source: { label: string; url: string };
}

const G = "https://www.gesetze-im-internet.de";
const AZV = { label: "BAföG-AuslandszuschlagsV", url: `${G}/baf_gzuschlagsv/BJNR009350986.html` };

/** Curated answers to general rule questions. Every entry carries the official source it comes from. */
export const KNOWLEDGE: KbEntry[] = [
  {
    id: "tuition",
    keywords: ["studiengebühren", "gebühren", "tuition", "fees", "5600", "5.600", "uni kosten", "semestergebühr"],
    question: { de: "Werden Studiengebühren im Ausland übernommen?", en: "Are tuition fees abroad covered?" },
    answer: {
      de: "Notwendige Studiengebühren werden für höchstens ein Jahr bis zu 5.600 € übernommen. Mehr ist nur möglich, wenn die Ausbildung nur an dieser Hochschule möglich ist. Sie müssen nachweisen, dass Sie einen Erlass oder eine Ermäßigung versucht haben. Der Betrag ist ein Zuschuss, kein Darlehen.",
      en: "Necessary tuition fees are covered for at most one year, up to 5,600 €. More is possible only if the training can be done only at that university. You must show that you asked for a waiver or a reduction. The amount is a grant, not a loan.",
    },
    source: { label: "BAföG-AuslandszuschlagsV § 3", url: AZV.url },
  },
  {
    id: "travel",
    keywords: ["reisekosten", "flug", "flight", "travel", "hinflug", "rückflug", "fahrt", "reise"],
    question: { de: "Gibt es Geld für Flüge?", en: "Is there money for flights?" },
    answer: {
      de: "Ja, als Pauschale für Hin- und Rückreise: 250 € je Reise innerhalb Europas und 500 € je Reise in andere Länder. In besonderen Härtefällen kann eine zusätzliche Hin- und Rückreise berücksichtigt werden.",
      en: "Yes, as a lump sum for the outbound and the return trip: 250 € per trip within Europe and 500 € per trip elsewhere. In special hardship cases one additional round trip can be considered.",
    },
    source: { label: "BAföG-AuslandszuschlagsV § 4", url: AZV.url },
  },
  {
    id: "insurance",
    keywords: ["versicherung", "krankenversicherung", "insurance", "health", "pflege", "krankenkasse", "zuschlag"],
    question: { de: "Gibt es einen Zuschuss zur Krankenversicherung?", en: "Is there a supplement for health insurance?" },
    answer: {
      de: "Ja. Wer gesetzlich pflichtversichert ist, erhält monatlich 102 € für die Krankenversicherung und 35 € für die Pflegeversicherung. Für freiwillig Versicherte sind es 185 € und 48 €. Ein Versicherungsnachweis ist nötig.",
      en: "Yes. If you are compulsorily insured in the statutory scheme you get 102 € a month for health and 35 € for care insurance. For voluntary members it is 185 € and 48 €. An insurance certificate is required.",
    },
    source: { label: "§ 13a BAföG", url: `${G}/baf_g/__13a.html` },
  },
  {
    id: "need",
    keywords: ["bedarf", "höhe", "wie viel", "how much", "monatlich", "monthly", "grundbedarf", "wohnkosten", "miete", "rent", "höchstsatz", "475", "380"],
    question: { de: "Wie hoch ist der monatliche Bedarf?", en: "How high is the monthly need?" },
    answer: {
      de: "Der Grundbedarf für Studierende an Hochschulen beträgt 475 €. Dazu kommen 380 € Wohnkosten, wenn Sie nicht bei den Eltern wohnen, sowie Zuschläge für Kranken- und Pflegeversicherung. Außerhalb der EU und der Schweiz kann ein Auslandszuschlag dazukommen. Was Sie tatsächlich bekommen, hängt vom Einkommen Ihrer Eltern ab.",
      en: "The basic need for university students is 475 €. On top come 380 € for housing if you do not live with your parents, and supplements for health and care insurance. Outside the EU and Switzerland a foreign-cost surcharge may be added. What you actually get depends on your parents' income.",
    },
    source: { label: "§ 13 BAföG", url: `${G}/baf_g/__13.html` },
  },
  {
    id: "surcharge",
    keywords: ["auslandszuschlag", "kaufkraft", "surcharge", "außerhalb der eu", "outside the eu", "non-eu", "land"],
    question: { de: "Was ist der Auslandszuschlag?", en: "What is the foreign-cost surcharge?" },
    answer: {
      de: "Außerhalb der EU und der Schweiz wird der Bedarf um einen Prozentsatz erhöht, wenn die Kaufkraft im Zielland niedriger ist. Den Prozentsatz legt das Auswärtige Amt je Land fest und er gilt für den gesamten Förderzeitraum.",
      en: "Outside the EU and Switzerland the need is increased by a percentage where purchasing power in the destination is lower. The foreign office sets the percentage per country and it applies for the whole funding period.",
    },
    source: { label: "BAföG-AuslandszuschlagsV § 1–2", url: AZV.url },
  },
  {
    id: "which-stays",
    keywords: ["voraussetzung", "wann", "mindestdauer", "sechs monate", "semester", "minimum", "duration", "dauer", "eligible", "förderfähig", "studium"],
    question: { de: "Welche Auslandsaufenthalte werden gefördert?", en: "Which stays abroad are funded?" },
    answer: {
      de: "Gefördert wird ein Studium im Ausland, das zum Ausbildungsstand passt und zum Teil auf Ihr Studium angerechnet wird. Außerhalb der EU muss der Aufenthalt in der Regel mindestens sechs Monate oder ein Semester dauern. Innerhalb der EU gelten teils kürzere Zeiten.",
      en: "A study stay abroad is funded if it suits your stage of study and at least partly counts toward your studies. Outside the EU the stay must usually last at least six months or one semester. Within the EU shorter periods apply in some cases.",
    },
    source: { label: "§ 5 BAföG", url: `${G}/baf_g/__5.html` },
  },
  {
    id: "internship",
    keywords: ["praktikum", "internship", "pflichtpraktikum", "praktikant", "zwölf wochen", "12 wochen", "mandatory"],
    question: { de: "Wird ein Praktikum im Ausland gefördert?", en: "Is an internship abroad funded?" },
    answer: {
      de: "Ja, wenn es nach der Prüfungsordnung vorgeschrieben ist, Ihrer Ausbildung dient und mindestens zwölf Wochen dauert. Ihre Hochschule muss das bestätigen. Der Praktikumsvertrag sollte von beiden Seiten unterschrieben sein.",
      en: "Yes, if it is required by your study regulations, benefits your training and lasts at least twelve weeks. Your university must confirm this. The internship contract should be signed by both sides.",
    },
    source: { label: "§ 5 Abs. 5 BAföG", url: `${G}/baf_g/__5.html` },
  },
  {
    id: "parents",
    keywords: ["eltern", "parents", "einkommen", "income", "freibetrag", "allowance", "elterneinkommen", "2540", "1690", "geschwister", "siblings"],
    question: { de: "Wie wird das Einkommen meiner Eltern angerechnet?", en: "How are my parents' earnings counted?" },
    answer: {
      de: "Vom Einkommen der Eltern bleibt ein Freibetrag unberührt: 2.540 € im Monat bei verheirateten Eltern, 1.690 € je Elternteil sonst. Für jedes weitere Kind, das nicht in einer förderfähigen Ausbildung ist, erhöht sich der Freibetrag um 770 €. Vom übersteigenden Teil bleiben 50 % anrechnungsfrei, plus 5 % je Kind.",
      en: "Part of your parents' income is protected by an allowance: 2,540 € a month for married parents, 1,690 € per parent otherwise. For each further child not in funded education the allowance rises by 770 €. Of the amount above, 50 % is not counted, plus 5 % per child.",
    },
    source: { label: "§ 25 BAföG", url: `${G}/baf_g/__25.html` },
  },
  {
    id: "income-year",
    keywords: ["einkommensjahr", "steuerbescheid", "tax", "bezugsjahr", "welches jahr", "which year", "vorletzt", "aktualisierung", "income year"],
    question: { de: "Welches Einkommensjahr wird für meine Eltern gebraucht?", en: "Which income year is needed for my parents?" },
    answer: {
      de: "Maßgeblich ist grundsätzlich das Einkommen des vorletzten Kalenderjahres vor Beginn des Bewilligungszeitraums. Beginnt Ihr Zeitraum 2027, wird also in der Regel das Jahr 2025 betrachtet. Sind die aktuellen Einkünfte deutlich niedriger, kann ein Antrag auf Aktualisierung gestellt werden.",
      en: "The income of the second-to-last calendar year before the funding period begins is what counts. If your period starts in 2027, the year 2025 is normally used. If current income is much lower, an update application can be made.",
    },
    source: { label: "§ 24 BAföG", url: `${G}/baf_g/__24.html` },
  },
  {
    id: "timing",
    keywords: ["wie lange", "bearbeitungszeit", "dauer", "how long", "processing", "wartezeit", "wait", "monate", "months", "früh", "early", "wann beantragen", "when to apply", "frist", "deadline"],
    question: { de: "Wie lange dauert die Bearbeitung und wann sollte ich beantragen?", en: "How long does processing take and when should I apply?" },
    answer: {
      de: "Auslandsanträge brauchen oft deutlich länger als Inlandsanträge. Planen Sie mehrere Monate ein, bis zu etwa sechs. Beantragen Sie so früh wie möglich und möglichst vollständig, denn Förderung gibt es frühestens ab dem Monat der Antragstellung.",
      en: "Applications for abroad often take much longer than domestic ones. Plan for several months, up to about six. Apply as early as possible and as completely as possible, because funding starts at the earliest in the month you apply.",
    },
    source: { label: "Merkblatt Auslands-BAföG (FH Erfurt)", url: "https://www.fh-erfurt.de/fileadmin/Dokumente/ZIB/Infomaterial/Auslands-BAfoeG.pdf" },
  },
  {
    id: "loan",
    keywords: ["darlehen", "loan", "zurückzahlen", "repay", "rückzahlung", "zuschuss", "grant", "10010"],
    question: { de: "Muss ich das Geld zurückzahlen?", en: "Do I have to pay the money back?" },
    answer: {
      de: "Die Förderung für Studierende wird zur Hälfte als Zuschuss und zur Hälfte als zinsloses Darlehen gezahlt. Der Zuschuss zu Studiengebühren ist ein reiner Zuschuss. Die Rückzahlung ist begrenzt.",
      en: "Funding for students is paid half as a grant and half as an interest-free loan. The tuition supplement is a pure grant. Repayment is capped.",
    },
    source: { label: "Informationen zum Auslands-BAföG (FAU)", url: "https://fau.de/international/wege-ins-ausland/finanzierung-eines-auslandsaufenthaltes/externe-foerdermoeglichkeiten/auslands-bafoeg" },
  },
  {
    id: "documents",
    keywords: ["unterlagen", "dokumente", "documents", "checkliste", "checklist", "formblatt", "welche", "required", "nachweis", "antrag"],
    question: { de: "Welche Unterlagen brauche ich?", en: "Which documents do I need?" },
    answer: {
      de: "Typisch sind: der Antrag (Formblatt 1), die Immatrikulationsbescheinigung, bei einem Studium die Bestätigung der Gasthochschule, bei einem Praktikum der unterschriebene Vertrag und die Bestätigung der Hochschule, ein Versicherungsnachweis sowie die Angaben und Nachweise zum Einkommen der Eltern (Formblatt 3). Ihre persönliche Liste sehen Sie in Ihrem Antrag.",
      en: "Typically: the application (Formblatt 1), the enrolment certificate, for a study stay the host university confirmation, for an internship the signed contract and your university's confirmation, an insurance certificate, and the details and proof of your parents' income (Formblatt 3). Your personal list is shown in your application.",
    },
    source: { label: "Checkliste Auslandsantrag (Studierendenwerk Hamburg)", url: "https://www.stwhh.de/fileadmin/user_upload/Finanzen/__Downloads/BAfoeG_Ausland_USA/Checklisten/Checkliste_Auslandsantrag_Praktikum.pdf" },
  },
  {
    id: "binding",
    keywords: ["verbindlich", "binding", "garantiert", "guaranteed", "schätzung", "estimate", "sicher", "sure", "zusage", "bescheid"],
    question: { de: "Ist die Schätzung verbindlich?", en: "Is the estimate binding?" },
    answer: {
      de: "Nein. Die Schätzung zeigt nur, was wahrscheinlich ist. Über Ihren Antrag entscheidet immer das Amt für Ausbildungsförderung mit einem Bescheid. Die Entscheidung trifft eine Sachbearbeiterin oder ein Sachbearbeiter, nie die Software.",
      en: "No. The estimate only shows what is likely. The office for student funding always decides on your application with a formal letter. A caseworker makes the decision, never the software.",
    },
    source: { label: "§ 50 BAföG", url: `${G}/baf_g/__50.html` },
  },
  {
    id: "apply",
    keywords: ["wo", "where", "online", "portal", "beantragen", "apply", "bafög digital", "antrag stellen"],
    question: { de: "Wo stelle ich den Antrag?", en: "Where do I apply?" },
    answer: {
      de: "Der offizielle Antrag läuft über das Online-Portal BAföG Digital. Dieser Assistent prüft Ihre Unterlagen vorab und leitet den fertigen Antrag weiter. Zuständig ist je nach Zielland ein bestimmtes Amt.",
      en: "The official application runs through the BAföG Digital online portal. This assistant checks your documents beforehand and forwards the finished application. Which office is responsible depends on your destination country.",
    },
    source: { label: "BAföG Digital", url: "https://www.bafoeg-digital.de" },
  },
];

export const KB_FALLBACK: { answer: Bilingual; source: { label: string; url: string } } = {
  answer: {
    de: "Dazu habe ich keine gesicherte Antwort in den hinterlegten offiziellen Quellen. Bitte fragen Sie Ihr Amt direkt oder schauen Sie auf BAföG Digital. Ich rate nicht.",
    en: "I do not have a reliable answer to that in the official sources I know. Please ask your office directly or check BAföG Digital. I do not guess.",
  },
  source: { label: "BAföG Digital", url: "https://www.bafoeg-digital.de" },
};

const norm = (s: string) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

/** Keyword retrieval. Returns the best entry, or null when nothing in the knowledge base matches. */
export function answerFromKnowledge(question: string): KbEntry | null {
  const q = norm(question);
  let best: { entry: KbEntry; score: number } | null = null;
  for (const entry of KNOWLEDGE) {
    let score = 0;
    for (const k of entry.keywords) if (q.includes(norm(k))) score += k.length > 5 ? 2 : 1;
    if (score > 0 && (!best || score > best.score)) best = { entry, score };
  }
  return best?.entry ?? null;
}

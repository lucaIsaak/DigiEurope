"use client";

import { Check, ChevronDown, Minus, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";

type L = [string, string];
type Section = "inbox" | "builder" | "templates" | "rules" | "insights" | "staff" | "settings" | "oversight";

interface Info {
  title: L;
  can: L[];
  cannot: L[];
  /** Who is responsible for adding, changing and deleting. */
  who: { what: L; who: L }[];
}

const CASEWORKER: L = ["Sachbearbeitung", "Caseworkers"];
const DESIGNER: L = ["Prozessverantwortliche (mit Builder-Zugriff)", "Process designers (with builder access)"];
const ADMIN: L = ["Amtsleitung / Administrator", "Office head / administrator"];
const OWNER: L = ["Verantwortliche für Extraktoren und Vorlagen", "Extractor owner"];

const INFO: Record<Section, Info> = {
  inbox: {
    title: ["Anträge bearbeiten", "Working on applications"],
    can: [
      ["Anträge öffnen, Dokumente und gelesene Felder prüfen", "Open applications and check documents and the fields read from them"],
      ["Unterlagen nachfordern", "Request missing documents"],
      ["Bewilligen oder ablehnen, mit Begründung für die Person", "Approve or reject, with an explanation for the student"],
    ],
    cannot: [
      ["Regeln, Vorlagen oder Prozesse ändern", "Change rules, templates or processes"],
      ["Anträge löschen. Entscheidungen bleiben im Protokoll", "Delete applications. Decisions stay on record"],
    ],
    who: [
      [["Entscheiden", "Decide"], CASEWORKER],
      [["Hinzufügen", "Add"], ["Studierende oder simuliertes Portal", "Students or the simulated portal"]],
      [["Löschen", "Delete"], ["Niemand im Tool (Aufbewahrungspflichten)", "Nobody in the tool (retention rules)"]],
    ].map(([what, who]) => ({ what: what as L, who: who as L })),
  },
  builder: {
    title: ["Prozesse", "Processes"],
    can: [
      ["Prozess zeichnen, prüfen und testen", "Draw, validate and test a process"],
      ["Veröffentlichen: Der Prozess steuert dann neue Anträge", "Publish: the process then drives new applications"],
      ["Erforderliche Angaben festlegen (Formulare, Fragen)", "Define required inputs (forms, questions)"],
    ],
    cannot: [
      ["Entscheidungen über Anträge treffen", "Decide on applications"],
      ["Festlegen, wie Dokumente gelesen werden (Extraktor-Verantwortliche)", "Decide how documents are read (extractor owner)"],
      ["Andere Ämter ändern", "Change other offices"],
    ],
    who: [
      [["Hinzufügen / ändern", "Add / change"], DESIGNER],
      [["Zugriff vergeben", "Grant access"], ADMIN],
      [["Löschen", "Delete"], ["Entwürfe: Prozessverantwortliche. Veröffentlichte Versionen bleiben im Verlauf", "Drafts: process designers. Published versions stay in the history"]],
    ].map(([what, who]) => ({ what: what as L, who: who as L })),
  },
  templates: {
    title: ["Vorlagen", "Templates"],
    can: [
      ["Alle Vorlagen ansehen, inklusive Felder und Verlauf", "See all templates, including fields and history"],
      ["Neue Vorlage vorschlagen, mit Beispiel-PDF", "Propose a new template, optionally with a sample PDF"],
      ["Extraktor-Verantwortliche: Vorschläge annehmen, Leseverfahren festlegen, testen und bestätigen", "Extractor owner: accept proposals, set the reading method, test and confirm"],
    ],
    cannot: [
      ["Eine Vorlage in einem Prozess verlangen, bevor sie bestätigt ist", "Require a template in a process before it is confirmed"],
      ["Das Leseverfahren ändern, wenn Sie nicht Extraktor-Verantwortliche sind", "Change the reading method unless you are the extractor owner"],
    ],
    who: [
      [["Hinzufügen (Vorschlag)", "Add (proposal)"], DESIGNER],
      [["Annehmen / ändern / bestätigen", "Accept / change / confirm"], OWNER],
      [["Löschen", "Delete"], ["Vorschlag zurückziehen: Autor. Bestätigte Vorlagen: Extraktor-Verantwortliche", "Withdraw a proposal: the author. Confirmed templates: extractor owner"]],
    ].map(([what, who]) => ({ what: what as L, who: who as L })),
  },
  rules: {
    title: ["Regeln", "Rules"],
    can: [
      ["Regeln, Prüfsätze und Versionsverlauf ansehen", "See rules, what is checked and the version history"],
      ["Mit Builder-Zugriff: Über „Neue Regel“ oben rechts eine eigene Regel des Amts anlegen", "With builder access: add an office rule of your own with “New rule” at the top right"],
      ["Mit Builder-Zugriff: Änderung als Entwurf speichern (no-code Editor)", "With builder access: save a change as a draft (no-code editor)"],
      ["Mit Builder-Zugriff: Entwurf einer anderen Person freigeben, wenn die Testfälle bestehen", "With builder access: approve another person's draft once the sample cases pass"],
    ],
    cannot: [
      ["Die eigene Änderung selbst freigeben (Vier-Augen-Prinzip)", "Approve your own change (two-person rule)"],
      ["Eine Regel freigeben, deren Testfälle fehlschlagen", "Approve a rule whose sample cases fail"],
      ["Bundesregeln ändern. Sie sind für alle Ämter gleich; das Amt stellt nur lokale Werte ein", "Change federal rules. They are shared by all offices; the office only configures local parts"],
    ],
    who: [
      [["Hinzufügen / ändern", "Add / change"], DESIGNER],
      [["Freigeben", "Approve"], ["Eine zweite Person mit Builder-Zugriff", "A second person with builder access"]],
      [["Pausieren / löschen", "Pause / delete"], ["Pausieren: Builder-Zugriff. Gelöscht wird nie, die Version bleibt im Verlauf", "Pause: builder access. Nothing is deleted, the version stays in the history"]],
    ].map(([what, who]) => ({ what: what as L, who: who as L })),
  },
  insights: {
    title: ["Auswertung", "Insights"],
    can: [
      ["Häufige Fehler bei der ersten Prüfung sehen", "See the most frequent first-check issues"],
      ["Empfehlungen zur Verbesserung des Antragsformulars lesen", "Read recommendations for improving the application form"],
    ],
    cannot: [
      ["Hier etwas ändern. Die Seite ist nur lesbar", "Change anything here. This page is read-only"],
    ],
    who: [
      [["Formular ändern", "Change the form"], ["Amtsleitung entscheidet, Prozessverantwortliche setzen um", "The office head decides, process designers implement"]],
      [["Hinzufügen / löschen", "Add / delete"], ["Wird automatisch aus Anträgen berechnet", "Calculated automatically from applications"]],
    ].map(([what, who]) => ({ what: what as L, who: who as L })),
  },
  staff: {
    title: ["Zugriff", "Access"],
    can: [
      ["Konten ansehen und Rechte vergeben: Builder-Zugriff, Extraktor-Verantwortung", "See accounts and grant rights: builder access, extractor-owner permission"],
    ],
    cannot: [
      ["Nur Administratoren sehen diese Seite", "Only administrators see this page"],
    ],
    who: [
      [["Hinzufügen / ändern / entziehen", "Add / change / remove"], ADMIN],
    ].map(([what, who]) => ({ what: what as L, who: who as L })),
  },
  settings: {
    title: ["Einstellungen", "Settings"],
    can: [
      ["Lokale Einstellungen des Amts: Antwortziel, Leseverfahren für unbekannte Dokumente", "Local office settings: reply target, reading method for unrecognised documents"],
    ],
    cannot: [
      ["Bundesregeln ändern", "Change federal rules"],
      ["Als Sachbearbeitung: diese Seite ist nicht sichtbar", "As a caseworker: this page is not visible"],
    ],
    who: [
      [["Ändern", "Change"], [`${ADMIN[0]} und ${OWNER[0]}`, `${ADMIN[1]} and ${OWNER[1]}`]],
      [["Hinzufügen / löschen", "Add / delete"], ["Nur über die vorhandenen Felder", "Only through the existing fields"]],
    ].map(([what, who]) => ({ what: what as L, who: who as L })),
  },
  oversight: {
    title: ["Aufsicht", "Oversight"],
    can: [
      ["Prozesse aller Ämter nebeneinander vergleichen: Struktur, Einstellungen, Kennzahlen, Harmonie-Wert", "Compare each process across all offices: structure, settings, metrics, harmony score"],
    ],
    cannot: [
      ["Etwas ändern. Der Vergleich ist nur lesbar", "Change anything. The comparison is read-only"],
      ["Anträge oder die Arbeit eines Amts öffnen", "Open applications or work inside an office"],
    ],
    who: [
      [["Prozesse ändern", "Change processes"], ["Jedes Amt für sich", "Each office on its own"]],
      [["Referenzmodell", "Reference model"], ["Aufsicht legt es fest; Ämter entscheiden, ob sie folgen", "Oversight defines it; offices decide whether to follow"]],
    ].map(([what, who]) => ({ what: what as L, who: who as L })),
  },
};

export function sectionOf(path: string): Section {
  if (path.startsWith("/oversight")) return "oversight";
  if (path.startsWith("/office/builder") || path.startsWith("/office/processes")) return "builder";
  if (path.startsWith("/office/templates") || path.startsWith("/office/inputs")) return "templates";
  if (path.startsWith("/office/rules")) return "rules";
  if (path.startsWith("/office/insights")) return "insights";
  if (path.startsWith("/office/staff")) return "staff";
  if (path.startsWith("/office/settings")) return "settings";
  return "inbox";
}

/** "Your role": closed by default, explains what this person can do on this page, what not, and who is responsible. */
export function RoleInfo({ path, inline = false }: { path: string; inline?: boolean }) {
  const { lang } = useI18n();
  const { staff, canBuild } = useStaff();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const i = lang === "de" ? 0 : 1;
  const section = sectionOf(path);
  const info = INFO[section];
  useEffect(() => {
    setOpen(false);
  }, [section]);
  useEffect(() => {
    if (!open || inline) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, inline]);
  if (!staff) return null;

  const owner = Boolean(staff.canApproveTemplates);
  const roles: L[] = [];
  if (staff.isOversight) roles.push(["Aufsicht", "Oversight"]);
  else {
    if (staff.isAdmin) roles.push(["Administrator", "Administrator"]);
    if (canBuild && !staff.isAdmin) roles.push(["Prozessverantwortliche/r", "Process designer"]);
    if (owner) roles.push(["Extraktor-Verantwortliche/r", "Extractor owner"]);
    if (roles.length === 0) roles.push(["Sachbearbeitung", "Caseworker"]);
  }
  const edits =
    section === "inbox" ? !staff.isOversight
    : section === "builder" || section === "rules" ? canBuild
    : section === "templates" ? canBuild || owner
    : section === "staff" ? Boolean(staff.isAdmin)
    : section === "settings" ? Boolean(staff.isAdmin || owner)
    : false;
  const L2 = (v: L) => v[i];
  return (
    <div className={`roleinfo${inline ? " inline" : ""}`} ref={ref}>
      <button type="button" className="roleinfo-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <UserRound size={14} />
        <span>{i === 0 ? "Ihre Rolle" : "Your role"}</span>
        <ChevronDown size={14} className="chev" />
      </button>
      {open && (
        <div className="roleinfo-pop" role="region" aria-label={i === 0 ? "Ihre Rolle" : "Your role"}>
          <div className="roleinfo-top">
            <div>
              <strong>{staff.name}</strong>
              <small>{roles.map(L2).join(" · ")}</small>
            </div>
            <span className={`badge ${edits ? "ok" : "muted"}`}>{edits ? (i === 0 ? "Darf hier arbeiten" : "Can work here") : i === 0 ? "Nur ansehen" : "View only"}</span>
          </div>
          <p className="roleinfo-where">{L2(info.title)}</p>
          <h4>{i === 0 ? "Das können Sie hier" : "What you can do here"}</h4>
          <ul>{info.can.map((c, n) => <li key={n}><Check size={14} className="y" />{L2(c)}</li>)}</ul>
          <h4>{i === 0 ? "Das können Sie hier nicht" : "What you cannot do here"}</h4>
          <ul>{info.cannot.map((c, n) => <li key={n}><Minus size={14} className="n" />{L2(c)}</li>)}</ul>
          <h4>{i === 0 ? "Wer ist verantwortlich" : "Who is responsible"}</h4>
          <dl>
            {info.who.map((w, n) => (
              <div key={n}><dt>{L2(w.what)}</dt><dd>{L2(w.who)}</dd></div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

"use client";

import { KNOWLEDGE } from "@digieurope/shared";
import { useEffect, useRef, useState } from "react";
import { Spinner, useAsyncError } from "@/components/ui";
import { api, type AssistantAnswer } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Turn {
  q: string;
  a: AssistantAnswer;
}

export default function Ask() {
  const { t, lang, bi } = useI18n();
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const { error, run } = useAsyncError();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => void api.meta().then((m) => setLiveAvailable(m.liveAssistant)).catch(() => undefined), []);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [turns, busy]);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setQ("");
    const a = await run(() => api.ask(question, lang, live));
    if (a) setTurns((x) => [...x, { q: question, a }]);
    setBusy(false);
  }

  return (
    <div className="narrow stack">
      <h1>{t("ask.title")}</h1>
      <p className="lead">{t("ask.lead")}</p>
      <section className="card stack" aria-live="polite">
        {turns.length === 0 && (
          <div>
            <p className="small muted">{t("ask.suggest")}</p>
            <div className="row">
              {KNOWLEDGE.slice(0, 8).map((k) => <button key={k.id} type="button" className="chip" onClick={() => ask(bi(k.question))}>{bi(k.question)}</button>)}
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="stack">
            <div className="chat-q">{turn.q}</div>
            <div>
              <p style={{ marginBottom: "0.5rem" }}>{turn.a.answer}</p>
              <div className="row small">
                <span className="muted">{t("ask.sources")}:</span>
                {turn.a.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a>)}
                <span className="pill pill-muted">{turn.a.mode === "live" ? t("ask.liveBadge") : t("ask.retrievalBadge")}</span>
              </div>
            </div>
          </div>
        ))}
        {busy && <Spinner label={t("common.loading")} />}
        <div ref={end} />
        <form className="row" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <input style={{ flex: 1, minWidth: 220 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ask.placeholder")} aria-label={t("ask.placeholder")} maxLength={300} />
          <button className="button" type="submit" disabled={busy || !q.trim()}>{t("ask.send")}</button>
        </form>
        {liveAvailable && (
          <label className="small row"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> {t("ask.live")}</label>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
      </section>
      <p className="small muted">{t("ask.notice")}</p>
    </div>
  );
}

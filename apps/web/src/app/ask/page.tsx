"use client";

import { KNOWLEDGE } from "@digieurope/shared";
import { ArrowUp, BookOpen, ExternalLink, MessageCircleQuestion, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAsyncError } from "@/components/ui";
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
  useEffect(() => {
    api.meta().then((m) => setLiveAvailable(m.liveAssistant)).catch(() => undefined);
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns, busy]);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setQ("");
    setTurns((x) => [...x, { q: question, a: { answer: "", sources: [], mode: "retrieval", matched: true } }]);
    const a = await run(() => api.ask(question, lang, live));
    setTurns((x) => (a ? [...x.slice(0, -1), { q: question, a }] : x.slice(0, -1)));
    setBusy(false);
  }

  return (
    <div className="narrow" style={{ paddingTop: "1rem" }}>
      <div className="page-head">
        <div>
          <span className="eyebrow"><MessageCircleQuestion size={14} />{t("nav.ask")}</span>
          <h1>{t("ask.title")}</h1>
          <p>{t("ask.lead")}</p>
        </div>
      </div>

      <div className="chat" aria-live="polite">
        <div className="bubble-a"><Sparkles size={16} color="var(--accent)" style={{ verticalAlign: "-3px", marginRight: 6 }} />{t("ask.hello")}</div>
        {turns.length === 0 && (
          <div className="suggest">
            {KNOWLEDGE.slice(0, 8).map((k) => (
              <button key={k.id} type="button" onClick={() => void ask(bi(k.question))}><BookOpen size={16} color="var(--primary)" />{bi(k.question)}</button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="chat">
            <div className="bubble-q">{turn.q}</div>
            <div className="bubble-a">
              {turn.a.answer ? (
                <>
                  <div>{turn.a.answer}</div>
                  <div className="src">
                    {turn.a.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />{s.label}</a>)}
                    <span className="tag">{turn.a.mode === "live" ? t("ask.liveBadge") : t("ask.retrievalBadge")}</span>
                  </div>
                </>
              ) : (
                <span className="row muted"><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />{t("ask.thinking")}</span>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>

      <form className="composer" style={{ marginTop: "1.5rem" }} onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ask.placeholder")} aria-label={t("ask.placeholder")} maxLength={300} />
        <button className="button" type="submit" disabled={busy || !q.trim()} aria-label={t("ask.send")}><ArrowUp size={18} /></button>
      </form>
      <div className="row small muted" style={{ justifyContent: "space-between", marginTop: "0.6rem" }}>
        <span>{t("ask.notice")}</span>
        {liveAvailable && <label className="row"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> {t("ask.live")}</label>}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}

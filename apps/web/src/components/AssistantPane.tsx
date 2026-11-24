"use client";

import { assistSuggestions, type Bilingual, type EditOp, type Graph, type SummaryLine } from "@digieurope/shared";
import { ArrowUp, Check, MessageCircle, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type AssistResponse } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "bot"; text: string; summary?: SummaryLine[]; changes?: Bilingual[]; ops?: EditOp[]; proposal?: Graph; state?: "open" | "applied" | "discarded"; note?: string };

/**
 * The assistant: a chat about this process. A person says what they want, the assistant answers in plain words and proposes a change;
 * the change is only a list of sentences until they press Apply, and Undo takes it back.
 */
export function AssistantPane({
  graph, onApply, onApplyProposal, onDocument, onUndo, canUndo, onClose,
}: {
  graph: () => Graph;
  onApply: (ops: EditOp[]) => void;
  onApplyProposal: (g: Graph) => void;
  onDocument: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onClose: () => void;
}) {
  const { t, bi, lang } = useI18n();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"simulated" | "live">("simulated");
  const [info, setInfo] = useState<{ live: boolean; model: string | null } | null>(null);
  const idRef = useRef(1);
  const endRef = useRef<HTMLDivElement | null>(null);
  const g = graph();
  const blank = g.nodes.length <= 1;

  useEffect(() => { api.generateInfo().then(setInfo).catch(() => setInfo({ live: false, model: null })); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setText("");
    const mine: Msg = { id: idRef.current++, role: "user", text: message };
    setMsgs((m) => [...m, mine]);
    setBusy(true);
    try {
      const history = [...msgs, mine].slice(-9, -1).map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.text }));
      const r: AssistResponse = await api.assist(message, graph(), mode, lang, history);
      if (r.action === "document") onDocument();
      setMsgs((m) => [...m, {
        id: idRef.current++, role: "bot", text: r.reply, summary: r.summary, changes: r.changes, ops: r.ops, proposal: r.proposal,
        state: r.ops.length || r.proposal ? "open" : undefined, note: r.fellBack ? t("asst.fellBack", { e: r.fellBack }) : undefined,
      }]);
    } catch (e) {
      setMsgs((m) => [...m, { id: idRef.current++, role: "bot", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  };

  const setState = (id: number, state: "applied" | "discarded") => setMsgs((m) => m.map((x) => (x.id === id && x.role === "bot" ? { ...x, state } : x)));
  const chips = assistSuggestions(g).map((s) => bi(s));

  return (
    <aside className="ws-chat" aria-label={t("asst.title")}>
      <header>
        <span className="ws-chat-ico"><Sparkles size={16} /></span>
        <div className="grow">
          <strong>{t("asst.title")}</strong>
          <small>{mode === "live" ? t("asst.live", { m: info?.model ?? "" }) : t("asst.demo")}</small>
        </div>
        {info?.live && (
          <button type="button" className="link-button small" onClick={() => setMode((x) => (x === "live" ? "simulated" : "live"))}>{mode === "live" ? t("asst.useDemo") : t("asst.useLive")}</button>
        )}
        <button className="icon-button" type="button" aria-label={t("builder.close")} onClick={onClose}><X size={16} /></button>
      </header>

      <div className="ws-chat-body">
        {msgs.length === 0 && (
          <div className="as-hello">
            <MessageCircle size={20} />
            <p><strong>{blank ? t("asst.helloBlank") : t("asst.hello")}</strong></p>
            <p className="small muted">{blank ? t("asst.helloBlankText") : t("asst.helloText")}</p>
          </div>
        )}
        {msgs.map((m) => m.role === "user" ? (
          <div key={m.id} className="as-me">{m.text}</div>
        ) : (
          <div key={m.id} className="as-bot">
            <p>{m.text}</p>
            {m.summary && (
              <ol className="as-story">
                {m.summary.map((l, i) => <li key={i} style={{ marginLeft: `${l.depth * 0.9}rem` }} className={/^(?:If|Wenn) /.test(bi(l.text)) ? "as-if" : undefined}>{bi(l.text)}</li>)}
              </ol>
            )}
            {m.changes && m.changes.length > 0 && (
              <ul className="as-changes">{m.changes.map((c, i) => <li key={i}>{bi(c)}</li>)}</ul>
            )}
            {m.proposal && m.state !== "applied" && <p className="small muted">{t("asst.proposalNote", { n: String(m.proposal.nodes.length) })}</p>}
            {m.note && <p className="small muted">{m.note}</p>}
            {m.state === "open" && (
              <div className="as-actions">
                <button type="button" className="button button-small" onClick={() => { if (m.proposal) onApplyProposal(m.proposal); else if (m.ops) onApply(m.ops); setState(m.id, "applied"); }}><Check size={14} />{t("asst.apply")}</button>
                <button type="button" className="button button-ghost button-small" onClick={() => setState(m.id, "discarded")}>{t("asst.discard")}</button>
              </div>
            )}
            {m.state === "applied" && (
              <div className="as-actions"><span className="small as-done"><Check size={13} />{t("asst.applied")}</span>{canUndo && <button type="button" className="link-button small" onClick={() => { onUndo(); setState(m.id, "discarded"); }}><Undo2 size={12} />{t("asst.undo")}</button>}</div>
            )}
            {m.state === "discarded" && <p className="small muted">{t("asst.discarded")}</p>}
          </div>
        ))}
        {busy && <div className="as-bot as-typing"><span /><span /><span /></div>}
        <div ref={endRef} />
      </div>

      <div className="ws-chat-foot">
        <div className="as-chips">
          {chips.slice(0, 5).map((c) => <button key={c} type="button" onClick={() => void send(c)} disabled={busy}>{c}</button>)}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <textarea
            rows={2}
            value={text}
            placeholder={blank ? t("asst.placeholderBlank") : t("asst.placeholder")}
            aria-label={t("asst.title")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          />
          <button type="submit" className="as-send" aria-label={t("asst.send")} disabled={busy || !text.trim()}><ArrowUp size={16} /></button>
        </form>
      </div>
    </aside>
  );
}

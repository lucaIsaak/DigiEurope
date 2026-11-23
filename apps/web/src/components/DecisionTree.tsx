"use client";

import { DECISION_TREE, type TreeLeaf, type TreeQuestion, type TreeWalk } from "@digieurope/shared";
import { CheckCircle2, CircleHelp, FileQuestion, UserSearch, XCircle } from "lucide-react";
import { Fragment } from "react";
import { useI18n } from "@/lib/i18n";

const byId = new Map(DECISION_TREE.nodes.map((n) => [n.id, n]));
const LEAF_ICON = { approved: CheckCircle2, rejected: XCircle, ask: FileQuestion, review: UserSearch } as const;

/** The questions of the tree in order. Each has one way that carries on downwards and one exit to an outcome on the side. */
function spine() {
  const rows: { q: TreeQuestion; exit: "yes" | "no"; down: "yes" | "no"; exitLeaf: TreeLeaf; next: TreeQuestion | TreeLeaf }[] = [];
  let cur = byId.get(DECISION_TREE.start);
  while (cur && cur.kind === "question") {
    const yes = byId.get(cur.yes)!;
    const no = byId.get(cur.no)!;
    // When one answer leads to the next question, the other one is the exit. When both end here, "no" carries on to the last outcome.
    const down: "yes" | "no" = yes.kind === "question" ? "yes" : no.kind === "question" ? "no" : "no";
    const exit = down === "yes" ? "no" : "yes";
    const next = byId.get(cur[down])!;
    rows.push({ q: cur, exit, down, exitLeaf: byId.get(cur[exit]) as TreeLeaf, next });
    cur = next;
  }
  return rows;
}

function Leaf({ leaf, lit, faded, extra }: { leaf: TreeLeaf; lit: boolean; faded: boolean; extra?: string }) {
  const { bi } = useI18n();
  const Icon = LEAF_ICON[leaf.outcome];
  return (
    <div className={`dt-leaf ${leaf.outcome}${lit ? " lit" : ""}${faded ? " faded" : ""}`}>
      <Icon size={16} />
      <div>
        <strong>{bi(leaf.label)}</strong>
        <span>{bi(leaf.detail)}</span>
        {extra && <b className="dt-extra">{extra}</b>}
      </div>
    </div>
  );
}

/**
 * The decision tree of the rules as a picture. With a walk, the path of one case is lit, with the value each answer rests on.
 * Without one it is the tree itself, as every office uses it.
 */
export function DecisionTree({ walk, rules }: { walk?: TreeWalk; /** On the Rules page: names the rules behind each question and opens one. */ rules?: { title: (id: string) => string | undefined; open: (id: string) => void } }) {
  const { t, bi, eur } = useI18n();
  const rows = spine();
  const stepOf = (id: string) => walk?.steps.find((s) => s.id === id);
  const answerLabel = (a: "yes" | "no") => t(a === "yes" ? "dt.yes" : "dt.no");
  return (
    <div className={`dt${walk ? " walked" : ""}`}>
      {rows.map((r, i) => {
        const step = stepOf(r.q.id);
        const lit = Boolean(step);
        const exitLit = walk?.leaf === r.exitLeaf.id;
        const nextLit = r.next.kind === "question" ? Boolean(stepOf(r.next.id)) : walk?.leaf === r.next.id;
        const faded = Boolean(walk) && !lit;
        return (
          <Fragment key={r.q.id}>
            <div className="dt-row">
              <div className={`dt-q${lit ? " lit" : ""}${faded ? " faded" : ""}`}>
                <span className="dt-n">{i + 1}</span>
                <div>
                  <strong>{bi(r.q.question)}</strong>
                  {step ? (
                    <span className="dt-val">{bi(step.value)}</span>
                  ) : (
                    <span className="dt-look"><CircleHelp size={12} />{bi(r.q.looksAt)}</span>
                  )}
                  {rules && (
                    <div className="dt-rules">
                      <span>{r.q.rules.length ? t("dt.fedBy", { n: String(r.q.rules.length) }) : t("dt.calc")}</span>
                      {r.q.rules.map((id) => rules.title(id) && <button key={id} type="button" onClick={() => rules.open(id)}>{rules.title(id)}</button>)}
                    </div>
                  )}
                  <a className="dt-src" href={r.q.source.url} target="_blank" rel="noreferrer">{r.q.source.label}</a>
                </div>
                {step && <span className={`dt-ans ${step.answer}`}>{answerLabel(step.answer)}</span>}
              </div>
              <div className="dt-exit">
                <span className={`dt-arrow${exitLit ? " lit" : ""}${faded ? " faded" : ""}`}><span className={`dt-pill ${r.exit}`}>{answerLabel(r.exit)}</span></span>
                <Leaf leaf={r.exitLeaf} lit={exitLit} faded={Boolean(walk) && !exitLit} />
              </div>
            </div>
            <div className={`dt-down${nextLit ? " lit" : ""}${Boolean(walk) && !nextLit ? " faded" : ""}`}><span className={`dt-pill ${r.down}`}>{answerLabel(r.down)}</span></div>
            {r.next.kind === "leaf" && (
              <div className="dt-row">
                <Leaf leaf={r.next} lit={nextLit} faded={Boolean(walk) && !nextLit} extra={nextLit && r.next.outcome === "approved" && walk ? `${eur(walk.monthly)} ${t("common.perMonth")}` : undefined} />
                <div />
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

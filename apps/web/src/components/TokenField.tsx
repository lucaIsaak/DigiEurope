"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/** How a token such as {review.review_list} is shown: as a coloured tile named after the step that produced it. */
export interface TokenInfo {
  /** The name of the output, short. */
  text: string;
  /** The step it comes from, for example "Review fields" or "Review fields #2". Empty for the basics. */
  step: string;
  /** Colour of the step, 0 to 359. -1 for the basics, which are grey. */
  hue: number;
  /** False when the step is not connected before this one, so the value would be empty. */
  valid: boolean;
  title: string;
}

export interface TokenFieldHandle {
  insert: (raw: string) => void;
  focus: () => void;
}

const SPLIT = /(\{[A-Za-z0-9_-]+(?:\.[a-z_]+)?\})/;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function serialize(n: Node): string {
  if (n.nodeType === 3) return (n.textContent ?? "").replace(/ /g, " ");
  if (!(n instanceof HTMLElement)) return "";
  if (n.dataset.tok) return n.dataset.tok;
  if (n.tagName === "BR") return "\n";
  const inner = [...n.childNodes].map(serialize).join("");
  return n.tagName === "DIV" || n.tagName === "P" ? `\n${inner}` : inner;
}

/** A text field in which the outputs of earlier steps are tiles, like dynamic content in Power Automate. The stored text keeps {stepId.output}. */
export const TokenField = forwardRef<
  TokenFieldHandle,
  { value: string; onChange: (v: string) => void; multiline?: boolean; rows?: number; resolve: (raw: string) => TokenInfo | null; sig: string; onFocus?: () => void; label: string }
>(function TokenField({ value, onChange, multiline = false, rows = 3, resolve, sig, onFocus, label }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  const tileHtml = (raw: string): string | null => {
    const info = resolveRef.current(raw);
    if (!info) return null;
    return `<span class="tok${info.hue < 0 ? " glob" : ""}${info.valid ? "" : " bad"}" data-tok="${esc(raw)}" contenteditable="false" style="--h:${Math.max(info.hue, 0)}" title="${esc(info.title)}">${info.step ? `<small>${esc(info.step)}</small>` : ""}<b>${esc(info.text)}</b></span>`;
  };
  const toHtml = (v: string) => v.split(SPLIT).map((part, i) => (i % 2 === 1 ? tileHtml(part) ?? esc(part) : esc(part))).join("");

  useEffect(() => {
    const root = el.current;
    if (!root) return;
    if (root.dataset.sig !== sig || serialize(root) !== value) {
      root.innerHTML = toHtml(value);
      root.dataset.sig = sig;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, sig]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && el.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  };

  useImperativeHandle(ref, () => ({
    focus: () => el.current?.focus(),
    insert: (raw: string) => {
      const root = el.current;
      if (!root) return;
      const html = tileHtml(raw);
      if (!html) return;
      root.focus();
      let range = saved.current && root.contains(saved.current.commonAncestorContainer) ? saved.current : null;
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
      }
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      range.deleteContents();
      const wrap = document.createElement("span");
      wrap.innerHTML = html;
      const tile = wrap.firstChild!;
      const space = document.createTextNode(" ");
      range.insertNode(space);
      range.insertNode(tile);
      range.setStartAfter(space);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
      saved.current = range.cloneRange();
      onChange(serialize(root));
    },
  }));

  return (
    <div
      ref={el}
      className={`tokfield${multiline ? " multi" : ""}`}
      style={multiline ? { minHeight: `${rows * 1.55 + 0.9}em` } : undefined}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multiline}
      aria-label={label}
      spellCheck
      onFocus={onFocus}
      onInput={(e) => onChange(serialize(e.currentTarget))}
      onKeyUp={saveSelection}
      onMouseUp={saveSelection}
      onBlur={saveSelection}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (multiline) document.execCommand("insertText", false, "\n");
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
    />
  );
});

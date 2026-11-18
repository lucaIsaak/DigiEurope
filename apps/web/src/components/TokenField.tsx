"use client";

import { escapeSlot, parseSlot, segmentsOf } from "@digieurope/shared";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/** How a token such as {review.review_list} or a function is shown: as a coloured tile named after the step that produced it. */
export interface TokenInfo {
  /** The name of the output or the function, short. */
  text: string;
  /** The step it comes from, for example "Review fields". Empty for the basics and for functions. */
  step: string;
  /** Colour of the step, 0 to 359. -1 for the basics, which are grey. */
  hue: number;
  /** False when the step is not connected before this one, so the value would be empty. */
  valid: boolean;
  title: string;
  /** A function: shown as a tile you click to fill its slots. */
  fn?: boolean;
}

export interface TokenFieldHandle {
  insert: (raw: string) => void;
  focus: () => void;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function serialize(n: Node, slot: boolean): string {
  if (n.nodeType === 3) {
    const t = (n.textContent ?? "").replace(/ /g, " ");
    return slot ? escapeSlot(t) : t;
  }
  if (!(n instanceof HTMLElement)) return "";
  if (n.dataset.tok) return n.dataset.tok;
  if (n.tagName === "BR") return "\n";
  const inner = [...n.childNodes].map((c) => serialize(c, slot)).join("");
  // A block the browser made for a new line: a line break before it, unless it is the first thing.
  return (n.tagName === "DIV" || n.tagName === "P") && n.previousSibling ? `\n${inner}` : inner;
}

/**
 * A text field in which the outputs of earlier steps and functions are tiles, like dynamic content in Power Automate.
 * The stored text keeps {stepId.output} and {=function|slot|slot}.
 */
export const TokenField = forwardRef<
  TokenFieldHandle,
  {
    value: string;
    onChange: (v: string) => void;
    multiline?: boolean;
    rows?: number;
    resolve: (raw: string) => TokenInfo | null;
    sig: string;
    onFocus?: () => void;
    label: string;
    /** The slot of a function: \ | { } in the typed text are escaped, as the function syntax needs. */
    slot?: boolean;
    /** A function tile was clicked (or just inserted): edit its slots. `apply` puts the new text of the function into that tile. */
    onEditFn?: (raw: string, apply: (next: string) => void) => void;
  }
>(function TokenField({ value, onChange, multiline = false, rows = 3, resolve, sig, onFocus, label, slot = false, onEditFn }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const editing = useRef<HTMLElement | null>(null);
  /** A one-line field never holds a line break, whatever the browser made of the typing. */
  const text = (root: HTMLElement) => {
    const v = serialize(root, slot);
    return multiline ? v : v.replace(/\n/g, "");
  };
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  const tileHtml = (raw: string): string | null => {
    const info = resolveRef.current(raw);
    if (!info) return null;
    return `<span class="tok${info.hue < 0 ? " glob" : ""}${info.fn ? " fn" : ""}${info.valid ? "" : " bad"}" data-tok="${esc(raw)}" contenteditable="false" style="--h:${Math.max(info.hue, 0)}" title="${esc(info.title)}">${info.fn ? "<small>ƒ</small>" : info.step ? `<small>${esc(info.step)}</small>` : ""}<b>${esc(info.text)}</b></span>`;
  };
  const toHtml = (v: string) =>
    slot
      ? parseSlot(v).map((p) => (p.k === "text" ? esc(p.v) : (tileHtml(p.raw) ?? esc(p.raw)))).join("")
      : segmentsOf(v).map((p) => (p.tile ? (tileHtml(p.raw) ?? esc(p.raw)) : esc(p.raw))).join("");

  useEffect(() => {
    const root = el.current;
    if (!root) return;
    if (root.dataset.sig !== sig || text(root) !== value) {
      root.innerHTML = toHtml(value);
      root.dataset.sig = sig;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, sig]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && el.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  };

  /** Puts new text into the function tile that is being edited and tells the field. */
  const applyNext = (next: string) => {
    const span = editing.current;
    const root = el.current;
    if (!span || !root) return;
    const html = tileHtml(next);
    if (!html) return;
    const wrap = document.createElement("span");
    wrap.innerHTML = html;
    const fresh = wrap.firstChild as HTMLElement;
    span.replaceWith(fresh);
    editing.current = fresh;
    onChange(text(root));
  };

  const startEditing = (span: HTMLElement) => {
    editing.current = span;
    onEditFn?.(span.dataset.tok ?? "", applyNext);
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
      const tile = wrap.firstChild as HTMLElement;
      const space = document.createTextNode(" ");
      range.insertNode(space);
      range.insertNode(tile);
      range.setStartAfter(space);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
      saved.current = range.cloneRange();
      onChange(text(root));
      if (raw.startsWith("{=") && onEditFn) startEditing(tile);
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
      onInput={(e) => onChange(text(e.currentTarget))}
      onClick={(e) => {
        const t = (e.target as HTMLElement).closest(".tok.fn") as HTMLElement | null;
        if (t && onEditFn) startEditing(t);
      }}
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

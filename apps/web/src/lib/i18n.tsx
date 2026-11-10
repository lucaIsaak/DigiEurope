"use client";

import type { Lang } from "@digieurope/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { messages, type MessageKey } from "./messages";

type Params = Record<string, string | number>;

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey, params?: Params) => string;
  /** For keys built at runtime (e.g. pre-check codes). Falls back to the key itself. */
  tk: (key: string, params?: Params) => string;
  date: (iso?: string) => string;
  dateTime: (iso?: string) => string;
  country: (code: string) => string;
}

const Ctx = createContext<I18n | null>(null);
const STORAGE_KEY = "de.lang";
const TZ = "Europe/Berlin";

function interpolate(s: string, params?: Params) {
  return params ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : s;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "de" || stored === "en") setLangState(stored);
    else if (!navigator.language.toLowerCase().startsWith("de")) setLangState("en");
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = messages[lang] as Record<string, string>;
    const locale = lang === "de" ? "de-DE" : "en-GB";
    const names = new Intl.DisplayNames([locale], { type: "region" });
    const tk = (key: string, params?: Params) => interpolate(dict[key] ?? (messages.en as Record<string, string>)[key] ?? key, params);
    return {
      lang,
      setLang,
      t: tk,
      tk,
      date: (iso) => {
        if (!iso) return "–";
        const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
        return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
      },
      dateTime: (iso) =>
        iso ? new Date(iso).toLocaleString(locale, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "–",
      country: (code) => {
        if (!code) return "–";
        try {
          return names.of(code) ?? code;
        } catch {
          return code;
        }
      },
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside LanguageProvider");
  return ctx;
}

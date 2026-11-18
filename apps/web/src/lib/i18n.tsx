"use client";

import type { Bilingual, Lang } from "@digieurope/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { messages, type MessageKey } from "./messages";

type Params = Record<string, string | number>;

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey, params?: Params) => string;
  /** For keys built at runtime. Falls back to the key itself. */
  tk: (key: string, params?: Params) => string;
  /** Picks the current language from a bilingual text. */
  bi: (b: Bilingual) => string;
  eur: (n: number) => string;
  date: (iso?: string) => string;
  dateTime: (iso?: string) => string;
  country: (code: string) => string;
}

const Ctx = createContext<I18n | null>(null);
const STORAGE_KEY = "ms.lang";
const TZ = "Europe/Berlin";

function interpolate(s: string, params?: Params) {
  return params ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : s;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "de" || stored === "en") setLangState(stored);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    setLangState(l);
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = messages[lang] as Record<string, string>;
    const locale = lang === "de" ? "de-DE" : "en-GB";
    const names = new Intl.DisplayNames([locale], { type: "region" });
    const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
    const tk = (key: string, params?: Params) => interpolate(dict[key] ?? (messages.en as Record<string, string>)[key] ?? key, params);
    return {
      lang,
      setLang,
      t: tk,
      tk,
      bi: (b) => b[lang],
      eur: (n) => money.format(n),
      date: (iso) => {
        if (!iso) return "–";
        const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
        return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
      },
      dateTime: (iso) => (iso ? new Date(iso).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "–"),
      country: (code) => {
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

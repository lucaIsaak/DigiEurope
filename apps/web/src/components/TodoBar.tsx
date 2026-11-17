"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Todo } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Tells the signed-in person what is waiting for them, and refreshes when something changes. */
export function useTodo(): Todo | null {
  const [todo, setTodo] = useState<Todo | null>(null);
  useEffect(() => {
    const load = () => {
      api.todo().then(setTodo).catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 15000);
    window.addEventListener("ms:todo", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("ms:todo", load);
    };
  }, []);
  return todo;
}

export const refreshTodo = () => window.dispatchEvent(new Event("ms:todo"));

export interface TodoItem {
  key: string;
  text: string;
  tone?: "accent" | "info";
  href?: string;
  onClick?: () => void;
}

export function TodoBar({ items }: { items: TodoItem[] }) {
  const { t } = useI18n();
  if (items.length === 0) {
    return (
      <div className="todo" aria-label={t("todo.title")}>
        <span className="todo-item done"><CheckCircle2 size={16} />{t("todo.none")}</span>
      </div>
    );
  }
  return (
    <div className="todo" aria-label={t("todo.title")}>
      {items.map((i) =>
        i.href ? (
          <Link key={i.key} href={i.href} className={`todo-item${i.tone === "info" ? " info" : ""}`}>
            <span className="dot" aria-hidden />{i.text}<span className="go"><ArrowRight size={14} /></span>
          </Link>
        ) : (
          <button key={i.key} type="button" onClick={i.onClick} className={`todo-item${i.tone === "info" ? " info" : ""}`}>
            <span className="dot" aria-hidden />{i.text}<span className="go"><ArrowRight size={14} /></span>
          </button>
        ),
      )}
    </div>
  );
}

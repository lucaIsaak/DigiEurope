"use client";

import type { StaffMember } from "@digieurope/shared";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

interface StaffCtx {
  staff: StaffMember | null;
  loading: boolean;
  login: (id: string) => Promise<void>;
  logout: () => Promise<void>;
  canBuild: boolean;
}

const Ctx = createContext<StaffCtx | null>(null);
const KEY = "ms.staffToken";

export function StaffProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem(KEY);
    } catch {
      /* storage unavailable */
    }
    if (!token) {
      setLoading(false);
      return;
    }
    api.staffMe().then((m) => setStaff(m)).catch(() => setStaff(null)).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (id: string) => {
    const r = await api.staffLogin(id);
    sessionStorage.setItem(KEY, r.token);
    setStaff(r.staff);
  }, []);

  const logout = useCallback(async () => {
    await api.staffLogout().catch(() => undefined);
    sessionStorage.removeItem(KEY);
    setStaff(null);
  }, []);

  return <Ctx.Provider value={{ staff, loading, login, logout, canBuild: Boolean(staff && (staff.canBuild || staff.isAdmin)) }}>{children}</Ctx.Provider>;
}

export function useStaff(): StaffCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStaff must be used inside StaffProvider");
  return c;
}

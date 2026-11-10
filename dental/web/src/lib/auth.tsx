import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setCsrf } from "./api";

export interface Me {
  mfaPending?: boolean;
  mustChangePassword?: boolean;
  mfaEnrollmentRequired?: boolean;
  user: { id: string; email: string; fullName: string; isPlatformAdmin: boolean; mfaEnabled?: boolean };
  csrfToken: string;
  clinic: { id: string; name: string; timezone: string; currency: string } | null;
  branches: { id: string; code: string; name: string; city: string | null }[];
  membership: { role: string; roleLabel: string; allBranches: boolean; isProfessional: boolean } | null;
  permissions: string[];
  clinics: { id: string; name: string; roleLabel: string }[];
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (p: string) => boolean;
  branchId: string | null;
  setBranchId: (id: string | null) => void;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [branchId, setBranchIdState] = useState<string | null>(() => {
    try { return localStorage.getItem("branchId"); } catch { return null; }
  });
  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>("/api/auth/me");
      setCsrf(m.csrfToken);
      setMe(m);
      setBranchIdState((cur) => (cur && m.branches?.some((b) => b.id === cur) ? cur : m.branches?.length === 1 ? m.branches[0]!.id : null));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const onExpired = () => setMe(null);
    window.addEventListener("session-expired", onExpired);
    return () => window.removeEventListener("session-expired", onExpired);
  }, [refresh]);
  const setBranchId = (id: string | null) => {
    setBranchIdState(id);
    try { id ? localStorage.setItem("branchId", id) : localStorage.removeItem("branchId"); } catch { /* sin almacenamiento */ }
  };
  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    setMe(null);
  };
  const can = (p: string) => !!me?.permissions.includes(p);
  return <Ctx.Provider value={{ me, loading, refresh, logout, can, branchId, setBranchId }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

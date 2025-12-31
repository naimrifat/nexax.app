// src/context/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { supabase } from "././lib/supabaseClient";

interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

type AuthStatus = "booting" | "signed_out" | "signed_in";
type TenancyStatus = "idle" | "resolving" | "ready" | "missing" | "error";

interface AuthContextValue {
  user: AuthUser | null;

  // Tenancy
  workspaceId: string | null;
  internalUserId: string | null;

  // Status flags (DO NOT gate rendering on workspaceId/internalUserId alone)
  authStatus: AuthStatus;
  tenancyStatus: TenancyStatus;

  // Keep isLoading for backward compatibility, but it now means ONLY auth booting
  isLoading: boolean;

  signUp: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;

  refreshTenancy: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapUserToAuthUser(user: any): AuthUser | null {
  const id = user?.id;
  const email = user?.email;
  const createdAt = user?.created_at;
  if (!id || !email || !createdAt) return null;
  return { id, email, createdAt };
}

type TenancyRow = {
  workspace_id?: string;
  out_workspace_id?: string;
  user_id?: string;
  out_user_id?: string;
};

type TenancyResult = { workspaceId: string; internalUserId: string };

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: any;
  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(t)), timeout]);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [internalUserId, setInternalUserId] = useState<string | null>(null);

  const [authStatus, setAuthStatus] = useState<AuthStatus>("booting");
  const [tenancyStatus, setTenancyStatus] = useState<TenancyStatus>("idle");

  // Backward compatible: ONLY indicates auth bootstrap, NOT tenancy
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Authoritative current auth user id
  const currentAuthIdRef = useRef<string | null>(null);

  // Ensure tenancy once per auth user id
  const ensuredForAuthIdRef = useRef<string | null>(null);

  // Single-flight per auth user id
  const ensureInFlightByAuthIdRef = useRef<Map<string, Promise<TenancyResult>>>(new Map());

  // Prevent duplicate bootstrap application within same mount
  const bootstrappedOnceRef = useRef<boolean>(false);

  const clearTenancy = useCallback(() => {
    setWorkspaceId(null);
    setInternalUserId(null);
    setTenancyStatus("idle");
    ensuredForAuthIdRef.current = null;
    ensureInFlightByAuthIdRef.current.clear();
  }, []);

  const ensureWorkspaceOnceFor = useCallback(async (authUserId: string): Promise<TenancyResult> => {
    if (!authUserId) throw new Error("authUserId is required");

    // If already ensured, return current state if present
    if (
      ensuredForAuthIdRef.current === authUserId &&
      typeof workspaceId === "string" &&
      typeof internalUserId === "string"
    ) {
      return { workspaceId, internalUserId };
    }

    const existing = ensureInFlightByAuthIdRef.current.get(authUserId);
    if (existing) return await existing;

    setTenancyStatus("resolving");
    console.log("[Auth] Ensuring tenancy for", authUserId);

    const p = (async (): Promise<TenancyResult> => {
      try {
        const { data, error } = await withTimeout(
          supabase.rpc("ensure_user_and_workspace"),
          12_000,
          "ensure_user_and_workspace"
        );

        if (error) {
          console.error("[Auth] ensure_user_and_workspace failed:", error);
          throw error;
        }

        const row: TenancyRow = Array.isArray(data) ? data[0] : data;
        const ws = row?.workspace_id ?? row?.out_workspace_id ?? null;
        const iu = row?.user_id ?? row?.out_user_id ?? null;

        if (!ws || !iu) {
          console.error("[Auth] ensure_user_and_workspace returned unexpected data:", { data });
          // This is “missing” tenancy in practice (misconfigured RPC or unexpected result)
          throw new Error("Tenancy missing (no workspace_id/user_id)");
        }

        return { workspaceId: ws, internalUserId: iu };
      } finally {
        ensureInFlightByAuthIdRef.current.delete(authUserId);
      }
    })();

    ensureInFlightByAuthIdRef.current.set(authUserId, p);
    return await p;
  }, [workspaceId, internalUserId]);

  const applyAuthUser = useCallback(
    async (supaUser: any) => {
      const mapped = mapUserToAuthUser(supaUser);

      // Set authoritative auth id first (stale guard)
      currentAuthIdRef.current = mapped?.id ?? null;

      setUser(mapped);

      if (!mapped?.id) {
        setAuthStatus("signed_out");
        clearTenancy();
        return;
      }

      setAuthStatus("signed_in");

      // Tenancy resolution should NOT keep the app in a global loading screen
      // (this is what causes redirect loops in guards).
      try {
        const authIdAtStart = mapped.id;

        // If we already ensured for this auth id, keep tenancyStatus ready
        if (
          ensuredForAuthIdRef.current === authIdAtStart &&
          workspaceId &&
          internalUserId
        ) {
          setTenancyStatus("ready");
          return;
        }

        const res = await ensureWorkspaceOnceFor(authIdAtStart);

        // Stale guard: ignore if user changed mid-flight
        if (currentAuthIdRef.current !== authIdAtStart) return;

        ensuredForAuthIdRef.current = authIdAtStart;
        setWorkspaceId(res.workspaceId);
        setInternalUserId(res.internalUserId);
        setTenancyStatus("ready");

        console.log("[Auth] tenancy ensured", {
          authUserId: authIdAtStart,
          workspaceId: res.workspaceId,
          internalUserId: res.internalUserId,
        });
      } catch (e: any) {
        // Stale guard
        if (!mapped?.id || currentAuthIdRef.current !== mapped.id) return;

        // Distinguish “missing” vs generic “error”
        const msg = String(e?.message ?? "");
        if (msg.includes("Tenancy missing")) {
          setTenancyStatus("missing");
        } else {
          setTenancyStatus("error");
        }

        console.error("[Auth] tenancy ensure failed:", e);

        // Keep workspace/internalUser null if it failed
        setWorkspaceId(null);
        setInternalUserId(null);
        ensuredForAuthIdRef.current = null;
      }
    },
    [clearTenancy, ensureWorkspaceOnceFor, workspaceId, internalUserId]
  );

  const bootstrap = useCallback(async () => {
    if (bootstrappedOnceRef.current) return;
    bootstrappedOnceRef.current = true;

    console.log("[Auth] 🚀 Starting bootstrap...");
    setIsLoading(true);
    setAuthStatus("booting");

    try {
      const { data, error } = await supabase.auth.getSession();
      console.log("[Auth] 📦 getSession result:", { hasSession: !!data?.session, error });

      if (error) throw error;

      const supaUser = data?.session?.user ?? null;
      console.log("[Auth] 👤 User:", supaUser?.email || "none");

      await applyAuthUser(supaUser);
    } catch (err) {
      console.error("[Auth] ❌ bootstrap failed:", err);
      currentAuthIdRef.current = null;
      setUser(null);
      setAuthStatus("signed_out");
      clearTenancy();
    } finally {
      // End auth booting regardless of tenancy state
      setIsLoading(false);
      if (currentAuthIdRef.current) {
        setAuthStatus("signed_in");
      } else {
        setAuthStatus("signed_out");
      }
    }
  }, [applyAuthUser, clearTenancy]);

  useEffect(() => {
    let mounted = true;

    void bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      console.log("[Auth] 🔔 Auth state changed:", event);

      // Do not set isLoading here — auth is already bootstrapped.
      // Only update auth/tenancy state.
      const supaUser = session?.user ?? null;
      await applyAuthUser(supaUser);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [bootstrap, applyAuthUser]);

  const refreshTenancy = useCallback(async () => {
    const authUserId = currentAuthIdRef.current;
    if (!authUserId) return;

    ensuredForAuthIdRef.current = null;
    ensureInFlightByAuthIdRef.current.delete(authUserId);
    setTenancyStatus("resolving");

    try {
      const res = await ensureWorkspaceOnceFor(authUserId);

      if (currentAuthIdRef.current !== authUserId) return;

      ensuredForAuthIdRef.current = authUserId;
      setWorkspaceId(res.workspaceId);
      setInternalUserId(res.internalUserId);
      setTenancyStatus("ready");
    } catch (e: any) {
      if (currentAuthIdRef.current !== authUserId) return;

      const msg = String(e?.message ?? "");
      setTenancyStatus(msg.includes("Tenancy missing") ? "missing" : "error");
      setWorkspaceId(null);
      setInternalUserId(null);
      ensuredForAuthIdRef.current = null;
    }
  }, [ensureWorkspaceOnceFor]);

  const signUp = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");

    const { error } = await supabase.auth.signUp({ email: cleanEmail, password });
    if (error) throw error;
  };

  const login = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");

    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (error) throw error;

    // Do NOT setUser / ensure tenancy here.
    // onAuthStateChange will fire and applyAuthUser will own the state.
  };

  const logout = async () => {
    // Clear local state first to avoid stale in-flight tenancy writes
    currentAuthIdRef.current = null;
    setUser(null);
    setAuthStatus("signed_out");
    clearTenancy();
    setIsLoading(false);

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const value: AuthContextValue = {
    user,
    workspaceId,
    internalUserId,
    authStatus,
    tenancyStatus,
    isLoading,
    signUp,
    login,
    logout,
    refreshTenancy,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

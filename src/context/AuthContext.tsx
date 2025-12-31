// src/context/AuthContext.tsx
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";

interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  workspaceId: string | null;
  internalUserId: string | null;
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [internalUserId, setInternalUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Current auth user id (authoritative, prevents stale async writes)
  const currentAuthIdRef = useRef<string | null>(null);

  // Track which auth user we've ensured tenancy for
  const ensuredForAuthIdRef = useRef<string | null>(null);

  // Single-flight per auth user id
  const ensureInFlightByAuthIdRef = useRef<Map<string, Promise<TenancyResult>>>(new Map());

  // Dedupe bootstrap + onAuthStateChange
  const lastAppliedAuthIdRef = useRef<string | null>(null);

  const clearTenancy = useCallback(() => {
    setWorkspaceId(null);
    setInternalUserId(null);
    ensuredForAuthIdRef.current = null;
    ensureInFlightByAuthIdRef.current.clear();
  }, []);

  const ensureWorkspaceOnceFor = useCallback(async (authUserId: string): Promise<TenancyResult> => {
    if (!authUserId) throw new Error("authUserId is required");

    // If already ensured (and state populated), return immediately.
    if (
      ensuredForAuthIdRef.current === authUserId &&
      typeof workspaceId === "string" &&
      typeof internalUserId === "string"
    ) {
      return { workspaceId, internalUserId };
    }

    const existing = ensureInFlightByAuthIdRef.current.get(authUserId);
    if (existing) {
      console.log("[Auth] Waiting for in-flight tenancy call for", authUserId);
      return await existing;
    }

    console.log("[Auth] Ensuring tenancy for", authUserId);

    const p = (async (): Promise<TenancyResult> => {
      try {
        const { data, error } = await supabase.rpc("ensure_user_and_workspace");
        if (error) {
          console.error("[Auth] ensure_user_and_workspace failed:", error);
          throw error;
        }

        const row: TenancyRow = Array.isArray(data) ? data[0] : data;
        const ws = row?.workspace_id ?? row?.out_workspace_id ?? null;
        const iu = row?.user_id ?? row?.out_user_id ?? null;

        if (!ws || !iu) {
          console.error("[Auth] ensure_user_and_workspace returned unexpected data:", { data });
          throw new Error("Workspace setup did not return workspace_id/user_id");
        }

        return { workspaceId: ws, internalUserId: iu };
      } finally {
        // Always clear single-flight entry
        ensureInFlightByAuthIdRef.current.delete(authUserId);
      }
    })();

    ensureInFlightByAuthIdRef.current.set(authUserId, p);
    return await p;
  }, [workspaceId, internalUserId]);

  const applyAuthUser = useCallback(
    async (supaUser: any) => {
      const mapped = mapUserToAuthUser(supaUser);

      // Update authoritative current auth id ref immediately.
      currentAuthIdRef.current = mapped?.id ?? null;

      // Dedupe: if we've already applied this auth id AND tenancy is already ensured, do nothing.
      // This is critical to prevent bootstrap + onAuthStateChange double-processing.
      if (mapped?.id && lastAppliedAuthIdRef.current === mapped.id) {
        const alreadyEnsured =
          ensuredForAuthIdRef.current === mapped.id && !!workspaceId && !!internalUserId;
        if (alreadyEnsured) {
          return;
        }
      }

      setUser(mapped);

      if (!mapped?.id) {
        lastAppliedAuthIdRef.current = null;
        clearTenancy();
        return;
      }

      lastAppliedAuthIdRef.current = mapped.id;

      try {
        const authIdAtStart = mapped.id;

        // Make loading reflect tenancy resolution, not just session lookup.
        setIsLoading(true);

        const res = await ensureWorkspaceOnceFor(authIdAtStart);

        // STALE GUARD: only write tenancy if this user is still current.
        if (currentAuthIdRef.current !== authIdAtStart) {
          console.warn("[Auth] Ignoring stale tenancy result for", authIdAtStart);
          return;
        }

        ensuredForAuthIdRef.current = authIdAtStart;
        setWorkspaceId(res.workspaceId);
        setInternalUserId(res.internalUserId);

        console.log("[Auth] tenancy ensured", {
          authUserId: authIdAtStart,
          workspaceId: res.workspaceId,
          internalUserId: res.internalUserId,
        });
      } catch (e) {
        console.error("[Auth] tenancy ensure failed:", e);

        // If tenancy fails for the current user, keep user but clear tenancy
        if (currentAuthIdRef.current === mapped.id) {
          setWorkspaceId(null);
          setInternalUserId(null);
          ensuredForAuthIdRef.current = null;
        }
      } finally {
        // Only end loading if we are still on same auth id (avoid race with sign-out/sign-in)
        if (currentAuthIdRef.current === mapped.id) {
          setIsLoading(false);
        }
      }
    },
    [clearTenancy, ensureWorkspaceOnceFor, workspaceId, internalUserId]
  );

  const bootstrap = useCallback(async () => {
    console.log("[Auth] 🚀 Starting bootstrap...");
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.getSession();
      console.log("[Auth] 📦 getSession result:", { hasSession: !!data?.session, error });

      if (error) throw error;

      const supaUser = data?.session?.user ?? null;
      console.log("[Auth] 👤 User:", supaUser?.email || "none");

      await applyAuthUser(supaUser);
      console.log("[Auth] ✅ applyAuthUser complete");
    } catch (err) {
      console.error("[Auth] ❌ bootstrap failed:", err);

      // Clear everything on bootstrap failure
      currentAuthIdRef.current = null;
      lastAppliedAuthIdRef.current = null;
      setUser(null);
      clearTenancy();
      setIsLoading(false);
    }
  }, [applyAuthUser, clearTenancy]);

  useEffect(() => {
    let mounted = true;

    void bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      console.log("[Auth] 🔔 Auth state changed:", event);

      // Supabase can emit multiple events close together; we dedupe in applyAuthUser.
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

    setIsLoading(true);
    try {
      const res = await ensureWorkspaceOnceFor(authUserId);

      if (currentAuthIdRef.current !== authUserId) return;

      ensuredForAuthIdRef.current = authUserId;
      setWorkspaceId(res.workspaceId);
      setInternalUserId(res.internalUserId);
    } finally {
      if (currentAuthIdRef.current === authUserId) setIsLoading(false);
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

    const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    if (error) throw error;

    // Do NOT manually set user/tenancy here; onAuthStateChange + bootstrap logic handles it.
    // Manually setting it here is a common cause of double-processing and redirect thrash.
    // We keep this minimal to avoid race conditions.
    if (data?.user?.id) {
      // Optional: proactively apply immediately to reduce perceived latency
      await applyAuthUser(data.user);
    }
  };

  const logout = async () => {
    // Clear local state first to prevent stale in-flight tenancy results from “reviving” tenancy UI.
    currentAuthIdRef.current = null;
    lastAppliedAuthIdRef.current = null;
    setUser(null);
    clearTenancy();
    setIsLoading(false);

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const value: AuthContextValue = {
    user,
    workspaceId,
    internalUserId,
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

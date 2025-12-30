// src/context/AuthContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

interface AuthUser {
  id: string; // auth.users.id
  email: string;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  workspaceId: string | null;
  internalUserId: string | null; // public.users.id
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [internalUserId, setInternalUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Prevent concurrent tenancy ensures + prevent repeated ensures per auth user
  const ensuredForAuthIdRef = useRef<string | null>(null);
  const ensureInFlightRef = useRef<Promise<void> | null>(null);

  const clearTenancy = () => {
    setWorkspaceId(null);
    setInternalUserId(null);
    ensuredForAuthIdRef.current = null;
    ensureInFlightRef.current = null;
  };

  const ensureWorkspaceOnceFor = async (authUserId: string) => {
    if (!authUserId) return;

    // If already ensured for this auth user and we have values, do nothing.
    if (ensuredForAuthIdRef.current === authUserId && workspaceId && internalUserId) return;

    // If a call is already running, await it (do not start a new one).
    if (ensureInFlightRef.current) {
      await ensureInFlightRef.current;
      if (ensuredForAuthIdRef.current === authUserId && workspaceId && internalUserId) return;
    }

    ensureInFlightRef.current = (async () => {
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

      ensuredForAuthIdRef.current = authUserId;
      setWorkspaceId(ws);
      setInternalUserId(iu);

      console.log("[Auth] tenancy ensured", { authUserId, workspaceId: ws, internalUserId: iu });
    })().finally(() => {
      ensureInFlightRef.current = null;
    });

    await ensureInFlightRef.current;
  };

  const refreshTenancy = async () => {
    const authUserId = user?.id;
    if (!authUserId) return;

    ensuredForAuthIdRef.current = null;
    ensureInFlightRef.current = null;

    await ensureWorkspaceOnceFor(authUserId);
  };

  useEffect(() => {
    let mounted = true;

    const applyAuthUser = async (supaUser: any) => {
      const mapped = mapUserToAuthUser(supaUser);
      if (!mounted) return;

      setUser(mapped);

      if (mapped?.id) {
        try {
          await ensureWorkspaceOnceFor(mapped.id);
        } catch (e) {
          // Do not crash the app; UI can show retry via refreshTenancy()
          console.error("[Auth] tenancy ensure failed:", e);
        }
      } else {
        clearTenancy();
      }
    };

    const bootstrap = async () => {
      try {
        // getSession is the right bootstrap call; it matches onAuthStateChange behavior
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const supaUser = data?.session?.user ?? null;
        await applyAuthUser(supaUser);
      } catch (err) {
        console.error("[Auth] bootstrap failed:", err);
        if (mounted) {
          setUser(null);
          clearTenancy();
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        // IMPORTANT: do not set isLoading true here; that causes route flicker and can re-block pages.
        const supaUser = session?.user ?? null;
        await applyAuthUser(supaUser);
      } catch (err) {
        console.error("[Auth] onAuthStateChange handler failed:", err);
        // Keep app usable; worst case user remains as-is.
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signUp = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");

    const { error } = await supabase.auth.signUp({ email: cleanEmail, password });
    if (error) throw error;

    // Do not force tenancy here (email confirmation may prevent immediate session).
  };

  const login = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");

    const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    if (error) throw error;

    const mapped = mapUserToAuthUser(data?.user);
    setUser(mapped);

    const authUserId = mapped?.id;
    if (authUserId) {
      try {
        await ensureWorkspaceOnceFor(authUserId);
      } catch (e) {
        console.error("[Auth] tenancy ensure failed after login:", e);
      }
    } else {
      clearTenancy();
    }
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    setUser(null);
    clearTenancy();
  };

  const value = useMemo(
    () => ({ user, workspaceId, internalUserId, isLoading, signUp, login, logout, refreshTenancy }),
    [user, workspaceId, internalUserId, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

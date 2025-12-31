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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [internalUserId, setInternalUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Track which auth user we've ensured tenancy for
  const ensuredForAuthIdRef = useRef<string | null>(null);
  const ensureInFlightRef = useRef<Promise<void> | null>(null);

  const clearTenancy = useCallback(() => {
    setWorkspaceId(null);
    setInternalUserId(null);
    ensuredForAuthIdRef.current = null;
    ensureInFlightRef.current = null;
  }, []);

  const ensureWorkspaceOnceFor = useCallback(async (authUserId: string) => {
    if (!authUserId) return;

    // If already ensured for this auth user, skip
    if (ensuredForAuthIdRef.current === authUserId) {
      console.log("[Auth] Tenancy already ensured for", authUserId);
      return;
    }

    // If a call is already running, await it
    if (ensureInFlightRef.current) {
      console.log("[Auth] Waiting for in-flight tenancy call...");
      await ensureInFlightRef.current;
      return;
    }

    console.log("[Auth] Ensuring tenancy for", authUserId);

    ensureInFlightRef.current = (async () => {
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

        ensuredForAuthIdRef.current = authUserId;
        setWorkspaceId(ws);
        setInternalUserId(iu);

        console.log("[Auth] tenancy ensured", { authUserId, workspaceId: ws, internalUserId: iu });
      } finally {
        ensureInFlightRef.current = null;
      }
    })();

    await ensureInFlightRef.current;
  }, []);

  const refreshTenancy = useCallback(async () => {
    const authUserId = user?.id;
    if (!authUserId) return;

    ensuredForAuthIdRef.current = null;
    ensureInFlightRef.current = null;

    await ensureWorkspaceOnceFor(authUserId);
  }, [user?.id, ensureWorkspaceOnceFor]);

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
          console.error("[Auth] tenancy ensure failed:", e);
        }
      } else {
        clearTenancy();
      }
    };

    const bootstrap = async () => {
      console.log("[Auth] 🚀 Starting bootstrap...");
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
        if (mounted) {
          setUser(null);
          clearTenancy();
        }
      } finally {
        if (mounted) {
          console.log("[Auth] 🏁 Setting isLoading = false");
          setIsLoading(false);
        }
      }
    };

    void bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log("[Auth] 🔔 Auth state changed:", _event);
      try {
        const supaUser = session?.user ?? null;
        await applyAuthUser(supaUser);
      } catch (err) {
        console.error("[Auth] onAuthStateChange handler failed:", err);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [ensureWorkspaceOnceFor, clearTenancy]);

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

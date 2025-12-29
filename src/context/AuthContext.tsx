import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

interface AuthUser {
  id: string;          // auth.users.id (REQUIRED)
  email: string;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  workspaceId: string | null;     // recommended
  internalUserId: string | null;  // recommended (public.users.id)
  isLoading: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshTenancy: () => Promise<void>; // optional manual retry hook
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
  const [isLoading, setIsLoading] = useState(true);

  // Ensure we don't spam the RPC on repeated auth state events
  const ensuredForAuthIdRef = useRef<string | null>(null);

  const ensureWorkspaceOnceFor = async (authUserId: string) => {
    if (!authUserId) return;

    // Only run once per auth user id (per tab session)
    if (ensuredForAuthIdRef.current === authUserId && workspaceId && internalUserId) return;

    const { data, error } = await supabase.rpc("ensure_user_and_workspace");
    if (error) {
      console.error("ensure_user_and_workspace failed:", error);
      throw error;
    }

    const row: TenancyRow = Array.isArray(data) ? data[0] : data;
    const ws = row?.workspace_id ?? row?.out_workspace_id ?? null;
    const iu = row?.user_id ?? row?.out_user_id ?? null;

    if (!ws || !iu) {
      console.error("ensure_user_and_workspace returned unexpected data:", { data });
      throw new Error("Workspace setup did not return workspace_id/user_id");
    }

    ensuredForAuthIdRef.current = authUserId;
    setWorkspaceId(ws);
    setInternalUserId(iu);

    console.log("[Auth] tenancy ensured", { authUserId, workspaceId: ws, internalUserId: iu });
  };

  const refreshTenancy = async () => {
    if (!user?.id) return;
    // force refresh by clearing the guard
    ensuredForAuthIdRef.current = null;
    await ensureWorkspaceOnceFor(user.id);
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getUser()
      .then(async ({ data, error }) => {
        if (!mounted) return;
        if (error) console.error("getUser error:", error);

        const supaUser = data?.user ?? null;
        const mapped = mapUserToAuthUser(supaUser);

        setUser(mapped);
        setIsLoading(false);

        if (mapped?.id) {
          try {
            await ensureWorkspaceOnceFor(mapped.id);
          } catch {
            // keep app running; user-facing surfaces handled elsewhere
          }
        } else {
          setWorkspaceId(null);
          setInternalUserId(null);
          ensuredForAuthIdRef.current = null;
        }
      })
      .catch((err) => {
        console.error("getUser threw:", err);
        if (!mounted) return;
        setUser(null);
        setWorkspaceId(null);
        setInternalUserId(null);
        ensuredForAuthIdRef.current = null;
        setIsLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const supaUser = session?.user ?? null;
      const mapped = mapUserToAuthUser(supaUser);

      setUser(mapped);

      if (mapped?.id) {
        try {
          await ensureWorkspaceOnceFor(mapped.id);
        } catch {
          // keep app running
        }
      } else {
        setWorkspaceId(null);
        setInternalUserId(null);
        ensuredForAuthIdRef.current = null;
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [workspaceId, internalUserId]);

  const signUp = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");

    const { error } = await supabase.auth.signUp({ email: cleanEmail, password });
    if (error) throw error;

    // Some setups require email confirmation; do not force tenancy here.
    // User will run through sign-in flow; tenancy will be ensured on sign-in.
  };

  const login = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");

    const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    if (error) throw error;

    const authUserId = data?.user?.id;
    if (authUserId) {
      await ensureWorkspaceOnceFor(authUserId);
    }
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    setUser(null);
    setWorkspaceId(null);
    setInternalUserId(null);
    ensuredForAuthIdRef.current = null;
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

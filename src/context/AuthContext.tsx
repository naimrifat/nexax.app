import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

interface AuthUser {
  email: string;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapSessionToAuthUser(session: any): AuthUser | null {
  const email = session?.user?.email;
  const createdAt = session?.user?.created_at;
  if (!email || !createdAt) return null;
  return { email, createdAt };
}

async function ensureWorkspaceOnce() {
  const { error } = await supabase.rpc("ensure_user_and_workspace");
  if (error) {
    console.error("ensure_user_and_workspace failed:", error);
    throw error;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) console.error("getSession error:", error);
        setUser(mapSessionToAuthUser(data.session));
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("getSession threw:", err);
        if (!mounted) return;
        setUser(null);
        setIsLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(mapSessionToAuthUser(session));
      if (session) {
        try {
          await ensureWorkspaceOnce();
        } catch {
          // keep app running; surface errors elsewhere
        }
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");

    const { error } = await supabase.auth.signUp({ email: cleanEmail, password });
    if (error) throw error;

    const { data } = await supabase.auth.getSession();
    if (data.session) await ensureWorkspaceOnce();
  };

  const login = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");

    const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    if (error) throw error;

    await ensureWorkspaceOnce();
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
  };

  const value = useMemo(() => ({ user, isLoading, signUp, login, logout }), [user, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

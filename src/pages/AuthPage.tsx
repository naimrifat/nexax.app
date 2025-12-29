import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../../lib/supabaseClient";

/* =======================
   Types
======================= */

interface AuthUser {
  id: string;          // auth.users.id
  email: string;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  workspaceId: string | null;
  internalUserId: string | null; // public.users.id
  isLoading: boolean;
  refreshTenancy: () => Promise<void>;
  logout: () => Promise<void>;
}

type TenancyRow = {
  workspace_id?: string;
  out_workspace_id?: string;
  user_id?: string;
  out_user_id?: string;
};

/* =======================
   Context
======================= */

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/* =======================
   Helpers
======================= */

function mapUserToAuthUser(user: any): AuthUser | null {
  if (!user?.id || !user?.email || !user?.created_at) return null;
  return {
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
  };
}

/* =======================
   Provider
======================= */

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [internalUserId, setInternalUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Prevent RPC spam per auth user
  const ensuredForAuthIdRef = useRef<string | null>(null);

  /* -----------------------
     Tenancy resolver
  ----------------------- */

  const ensureTenancyFor = async (authUserId: string) => {
    if (!authUserId) return;

    if (
      ensuredForAuthIdRef.current === authUserId &&
      workspaceId &&
      internalUserId
    ) {
      return;
    }

    const { data, error } = await supabase.rpc("ensure_user_and_workspace");
    if (error) {
      console.error("[AuthContext] ensure_user_and_workspace failed:", error);
      throw error;
    }

    const row: TenancyRow = Array.isArray(data) ? data[0] : data;

    const ws = row?.workspace_id ?? row?.out_workspace_id ?? null;
    const iu = row?.user_id ?? row?.out_user_id ?? null;

    if (!ws || !iu) {
      console.error("[AuthContext] Bad tenancy payload:", data);
      throw new Error("Workspace setup returned invalid data");
    }

    ensuredForAuthIdRef.current = authUserId;
    setWorkspaceId(ws);
    setInternalUserId(iu);

    console.log("[AuthContext] tenancy ready", {
      authUserId,
      workspaceId: ws,
      internalUserId: iu,
    });
  };

  const refreshTenancy = async () => {
    if (!user?.id) return;
    ensuredForAuthIdRef.current = null;
    await ensureTenancyFor(user.id);
  };

  /* -----------------------
     Initial load
  ----------------------- */

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (!mounted) return;

        if (error) {
          console.error("[AuthContext] getUser error:", error);
          setIsLoading(false);
          return;
        }

        const supaUser = data?.user ?? null;
        const mapped = mapUserToAuthUser(supaUser);
        setUser(mapped);

        if (mapped?.id) {
          try {
            await ensureTenancyFor(mapped.id);
          } catch {
            // Non-blocking; pages may retry
          }
        } else {
          setWorkspaceId(null);
          setInternalUserId(null);
          ensuredForAuthIdRef.current = null;
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const supaUser = session?.user ?? null;
        const mapped = mapUserToAuthUser(supaUser);
        setUser(mapped);

        if (mapped?.id) {
          try {
            await ensureTenancyFor(mapped.id);
          } catch {
            // keep app running
          }
        } else {
          setWorkspaceId(null);
          setInternalUserId(null);
          ensuredForAuthIdRef.current = null;
        }
      }
    );

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /* -----------------------
     Logout
  ----------------------- */

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    setUser(null);
    setWorkspaceId(null);
    setInternalUserId(null);
    ensuredForAuthIdRef.current = null;
  };

  /* -----------------------
     Context value
  ----------------------- */

  const value = useMemo(
    () => ({
      user,
      workspaceId,
      internalUserId,
      isLoading,
      refreshTenancy,
      logout,
    }),
    [user, workspaceId, internalUserId, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/* =======================
   Hook
======================= */

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

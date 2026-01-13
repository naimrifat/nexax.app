// src/context/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { supabase } from "../../lib/supabaseClient";

interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

type AuthStatus = "booting" | "signed_out" | "signed_in";
type TenancyStatus = "idle" | "resolving" | "ready" | "missing" | "error";

interface AuthContextValue {
  user: AuthUser | null;

  workspaceId: string | null;
  internalUserId: string | null;

  authStatus: AuthStatus;
  tenancyStatus: TenancyStatus;

  // Back-compat: only means “auth bootstrap in progress”
  isLoading: boolean;

  tenancyError: string | null;
  isTenancyLoading: boolean;
  retryTenancy: () => Promise<void>;

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

/**
 * Safe timeout wrapper that does NOT rely on Promise.prototype.finally.
 * Also wraps non-Promise values via Promise.resolve().
 */
function withTimeout<T>(maybePromise: any, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);

    Promise.resolve(maybePromise)
      .then((value: T) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err: any) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [internalUserId, setInternalUserId] = useState<string | null>(null);

  const [authStatus, setAuthStatus] = useState<AuthStatus>("booting");
  const [tenancyStatus, setTenancyStatus] = useState<TenancyStatus>("idle");

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [tenancyError, setTenancyError] = useState<string | null>(null);
  const [isTenancyLoading, setIsTenancyLoading] = useState<boolean>(false);


  const currentAuthIdRef = useRef<string | null>(null);
  const ensuredForAuthIdRef = useRef<string | null>(null);
  const ensureInFlightByAuthIdRef = useRef<Map<string, Promise<TenancyResult>>>(new Map());
  const bootstrappedOnceRef = useRef<boolean>(false);
  const bootstrapIdRef = useRef<string | null>(null);
  const bootstrapStartedAtRef = useRef<number>(0);

  const clearTenancy = useCallback(() => {
    setWorkspaceId(null);
    setInternalUserId(null);
    setTenancyStatus("idle");
    setTenancyError(null);
    setIsTenancyLoading(false);
    ensuredForAuthIdRef.current = null;
    ensureInFlightByAuthIdRef.current.clear();
  }, []);

  const ensureWorkspaceOnceFor = useCallback(
    async (authUserId: string): Promise<TenancyResult> => {
      if (!authUserId) throw new Error("authUserId is required");

      // Already ensured and state present
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
      setTenancyError(null);
      setIsTenancyLoading(true);
      console.log("[Auth] Ensuring tenancy for", authUserId);

      const p = (async (): Promise<TenancyResult> => {
        const startedAt = Date.now();
        const bootstrapId = bootstrapIdRef.current;

        const isTimeoutLike = (err: any) => {
          const msg = String(err?.message || "").toLowerCase();
          const name = String(err?.name || "").toLowerCase();
          return msg.includes("timed out") || name.includes("timeout");
        };

        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

        try {
          const backoffs = [0, 300, 900];

          for (let attempt = 1; attempt <= 3; attempt++) {
            if (backoffs[attempt - 1]) await sleep(backoffs[attempt - 1]);

            try {
              // IMPORTANT: your lib/supabaseClient.ts already has a 12s abort on fetch.
              // If you keep another timeout here at 12s, you’re double-timing out.
              // Use a higher timeout to avoid false negatives (or remove this wrapper).
              const { data, error } = await withTimeout(
                supabase.rpc("ensure_user_and_workspace"),
                30_000,
                "ensure_user_and_workspace"
              );

              if (error) {
                console.warn("[Auth] ensure_user_and_workspace failed:", error);
                throw error;
              }

              const row: TenancyRow = Array.isArray(data) ? data[0] : data;
              const ws = row?.workspace_id ?? row?.out_workspace_id ?? null;
              const iu = row?.user_id ?? row?.out_user_id ?? null;

              if (!ws || !iu) {
                console.error("[Auth] ensure_user_and_workspace returned unexpected data:", { data });
                throw new Error("Tenancy missing (no workspace_id/user_id)");
              }

              return { workspaceId: ws, internalUserId: iu };
            } catch (err: any) {
              const elapsedMs = Date.now() - startedAt;
              const errMsg = String(err?.message || "");

              if (attempt < 3 && isTimeoutLike(err)) {
                console.warn("[Auth] tenancy ensure retry", {
                  attempt,
                  elapsedMs,
                  message: errMsg,
                  authUserId,
                  bootstrapId,
                });
                continue;
              }

              throw err;
            }
          }

          throw new Error("ensure_user_and_workspace timed out after retries");
        } finally {
          ensureInFlightByAuthIdRef.current.delete(authUserId);
          setIsTenancyLoading(false);
        }
      })();

      ensureInFlightByAuthIdRef.current.set(authUserId, p);
      return await p;
    },
    [workspaceId, internalUserId]
  );

  const applyAuthUser = useCallback(
    async (supaUser: any) => {
      const mapped = mapUserToAuthUser(supaUser);
      currentAuthIdRef.current = mapped?.id ?? null;

      setUser(mapped);

      if (!mapped?.id) {
        setAuthStatus("signed_out");
        clearTenancy();
        return;
      }

      setAuthStatus("signed_in");

      try {
        const authIdAtStart = mapped.id;
        const ensureStartedAt = Date.now();
        const bootstrapId = bootstrapIdRef.current;

        // If already ensured, mark ready
        if (
          ensuredForAuthIdRef.current === authIdAtStart &&
          workspaceId &&
          internalUserId
        ) {
          setTenancyStatus("ready");
          return;
        }

        console.debug("[Auth] tenancy ensure start", { bootstrapId, authUserId: authIdAtStart });
        const res = await ensureWorkspaceOnceFor(authIdAtStart);
        console.debug("[Auth] tenancy ensure end", { bootstrapId, authUserId: authIdAtStart, ms: Date.now() - ensureStartedAt });

        // Stale guard
        if (currentAuthIdRef.current !== authIdAtStart) return;

        ensuredForAuthIdRef.current = authIdAtStart;
        setWorkspaceId(res.workspaceId);
        setInternalUserId(res.internalUserId);
        setTenancyStatus("ready");
        setTenancyError(null);
        setIsTenancyLoading(false);

        console.log("[Auth] tenancy ensured", {
          authUserId: authIdAtStart,
          workspaceId: res.workspaceId,
          internalUserId: res.internalUserId,
          bootstrapId,
        });
      } catch (e: any) {
        if (!mapped?.id || currentAuthIdRef.current !== mapped.id) return;

        const msg = String(e?.message ?? "");
        setTenancyStatus(msg.includes("Tenancy missing") ? "missing" : "error");
        setTenancyError("We couldn’t load your workspace. Please retry.");
        setIsTenancyLoading(false);

        console.error("[Auth] tenancy ensure failed", { bootstrapId: bootstrapIdRef.current, message: msg });

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

    const bootstrapId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    bootstrapIdRef.current = bootstrapId;
    bootstrapStartedAtRef.current = Date.now();

    console.log("[Auth] 🚀 Starting bootstrap...", { bootstrapId });
    setIsLoading(true);
    setIsTenancyLoading(false);
    setTenancyError(null);
    setAuthStatus("booting");

    try {
      console.debug("[Auth] getSession start", { bootstrapId });
      const getSessionStartedAt = Date.now();
      const { data, error } = await supabase.auth.getSession();
      console.debug("[Auth] getSession end", {
        bootstrapId,
        ms: Date.now() - getSessionStartedAt,
        hasSession: !!data?.session,
        error: error ? String((error as any)?.message || error) : null,
      });

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
      const totalMs = Date.now() - bootstrapStartedAtRef.current;
      console.debug("[Auth] bootstrap end", { bootstrapId, ms: totalMs });
      bootstrapIdRef.current = null;
      setIsLoading(false);
      setAuthStatus(currentAuthIdRef.current ? "signed_in" : "signed_out");
    }
  }, [applyAuthUser, clearTenancy]);


  useEffect(() => {
    let mounted = true;

    void bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      console.log("[Auth] 🔔 Auth state changed:", event);

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

    setTenancyError(null);
    setIsTenancyLoading(true);

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
      setTenancyError(null);
    } catch (e: any) {
      if (currentAuthIdRef.current !== authUserId) return;

      const msg = String(e?.message ?? "");
      setTenancyStatus(msg.includes("Tenancy missing") ? "missing" : "error");
      setTenancyError("We couldn’t load your workspace. Please retry.");
      setWorkspaceId(null);
      setInternalUserId(null);
      ensuredForAuthIdRef.current = null;
    } finally {
      setIsTenancyLoading(false);
    }
  }, [ensureWorkspaceOnceFor]);

  const retryTenancy = useCallback(async () => {
    await refreshTenancy();
  }, [refreshTenancy]);


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

    // Do not set state here. onAuthStateChange handles it.
  };

  const logout = async () => {
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
    tenancyError,
    isTenancyLoading,
    retryTenancy,
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

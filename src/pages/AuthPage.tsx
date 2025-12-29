import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

type LocationState = {
  from?: string;
};

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function AuthPage() {
  const [email, setEmail] = React.useState<string>("");
  const [password, setPassword] = React.useState<string>("");
  const [mode, setMode] = React.useState<"signin" | "signup">("signin");
  const [status, setStatus] = React.useState<string>("");

  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as LocationState;
  const redirectTo = state.from || "/dashboard";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("Working...");

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setStatus("Email is required.");
      return;
    }
    if (!password) {
      setStatus("Password is required.");
      return;
    }

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });
        if (error) throw error;

        // For email/password, Supabase may require email confirmation depending on your settings.
        setStatus("Signup successful. Please sign in.");
        setMode("signin");
        return;
      }

      // Sign in
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (signInError) throw signInError;

      // Confirm we actually have a session/user before calling RPC.
      const userId = signInData?.user?.id;
      if (!userId) {
        // Extremely rare, but safer than proceeding.
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session?.user?.id) {
          throw new Error("Signed in, but session was not established. Please try again.");
        }
      }

      // Ensure workspace + local user exist (idempotent).
      // Do NOT let this hang your entire login flow.
      setStatus("Finalizing account...");
      try {
        const { data } = await ensureWorkspaceWithRetry();
        const row: any = Array.isArray(data) ? data[0] : data;
        const workspaceId = row?.workspace_id ?? row?.out_workspace_id;
        console.log("[AuthPage] ensure_user_and_workspace ok", { workspaceId });
      } catch (rpcErr: any) {
        // If RPC fails, we still allow navigation. AuthProvider/other flows can re-attempt.
        console.error("[AuthPage] ensure_user_and_workspace failed (non-blocking):", rpcErr);
        setStatus("Signed in. (Workspace setup is still syncing—if something fails, refresh.)");
        navigate(redirectTo, { replace: true });
        return;
      }

      setStatus("Signed in.");
      navigate(redirectTo, { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Auth failed.";
      setStatus(message);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h2>{mode === "signup" ? "Create account" : "Sign in"}</h2>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />

        <button type="submit">
          {mode === "signup" ? "Sign up" : "Sign in"}
        </button>
      </form>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => {
            setStatus("");
            setMode(mode === "signup" ? "signin" : "signup");
          }}
        >
          Switch to {mode === "signup" ? "sign in" : "sign up"}
        </button>
      </div>

      {status ? <p style={{ marginTop: 12 }}>{status}</p> : null}
    </div>
  );
}

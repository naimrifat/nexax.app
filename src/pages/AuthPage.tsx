import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [status, setStatus] = useState<string>("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Working...");

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setStatus("Email is required.");

    try {
      // EMAIL + PASSWORD (recommended for simplest flow)
      if (!password) return setStatus("Password is required.");

      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: cleanEmail, password });
        if (error) throw error;
        setStatus("Signup successful. You can sign in now (or check email if confirmation is enabled).");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        setStatus("Signed in.");
      }
    } catch (err: any) {
      setStatus(err?.message ?? "Auth failed.");
    }
  }

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
        <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
          Switch to {mode === "signup" ? "sign in" : "sign up"}
        </button>
      </div>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}
    </div>
  );
}

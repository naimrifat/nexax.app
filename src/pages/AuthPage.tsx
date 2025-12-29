// src/pages/AuthPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext"; // adjust if your path differs

type LocationState = {
  from?: string;
};

const AuthPage: React.FC = () => {
  const [email, setEmail] = React.useState<string>("");
  const [password, setPassword] = React.useState<string>("");
  const [mode, setMode] = React.useState<"signin" | "signup">("signin");
  const [status, setStatus] = React.useState<string>("");

  const { signUp, login } = useAuth();

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
        await signUp(cleanEmail, password);

        // Depending on Supabase email-confirm settings, user may need to confirm email first.
        setStatus("Signup successful. Please sign in.");
        setMode("signin");
        return;
      }

      // Sign in (AuthContext will ensure tenancy via auth state change)
      await login(cleanEmail, password);

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

        <button type="submit">{mode === "signup" ? "Sign up" : "Sign in"}</button>
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
};

export { AuthPage };
export default AuthPage;

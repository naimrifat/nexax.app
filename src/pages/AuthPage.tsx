// src/pages/AuthPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

type LocationState = {
  from?: string;
};

type AuthMode = "login" | "signup" | "reset";

type AuthPageProps = {
  initialMode?: AuthMode;
};

const AuthPage: React.FC<AuthPageProps> = ({ initialMode = "login" }) => {
  const [email, setEmail] = React.useState<string>("");
  const [password, setPassword] = React.useState<string>("");
  const [confirmPassword, setConfirmPassword] = React.useState<string>("");
  const [mode, setMode] = React.useState<AuthMode>(initialMode);
  const [status, setStatus] = React.useState<string>("");

  const { signUp, login, resetPassword } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as LocationState;
  const redirectTo = state.from || "/dashboard";

  // Keep mode in sync when route changes (/login -> /signup -> /reset)
  React.useEffect(() => {
    setMode(initialMode);
    setStatus("");
    setPassword("");
    setConfirmPassword("");
  }, [initialMode]);

  const needsConfirm = mode === "signup" || mode === "reset";

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

    if (needsConfirm && password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    try {
      if (mode === "signup") {
        await signUp(cleanEmail, password);
        setStatus("Signup successful. Please log in.");
        navigate("/login", { replace: true, state: { from: redirectTo } });
        return;
      }

      if (mode === "reset") {
        await resetPassword(cleanEmail, password);
        setStatus("Password updated. Please log in.");
        navigate("/login", { replace: true, state: { from: redirectTo } });
        return;
      }

      // login
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
      <h2>
        {mode === "signup" ? "Create account" : mode === "reset" ? "Reset password" : "Log in"}
      </h2>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <input
          placeholder={mode === "reset" ? "New password" : "Password"}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" || mode === "reset" ? "new-password" : "current-password"}
        />

        {needsConfirm && (
          <input
            placeholder="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        )}

        <button type="submit">
          {mode === "signup" ? "Sign up" : mode === "reset" ? "Update password" : "Log in"}
        </button>
      </form>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {mode !== "login" && (
          <button
            type="button"
            onClick={() => {
              setStatus("");
              navigate("/login", { state: { from: redirectTo } });
            }}
          >
            Back to log in
          </button>
        )}

        {mode !== "signup" && (
          <button
            type="button"
            onClick={() => {
              setStatus("");
              navigate("/signup", { state: { from: redirectTo } });
            }}
          >
            Create an account
          </button>
        )}

        {mode !== "reset" && (
          <button
            type="button"
            onClick={() => {
              setStatus("");
              navigate("/reset", { state: { from: redirectTo } });
            }}
          >
            Forgot password?
          </button>
        )}
      </div>

      {status ? <p style={{ marginTop: 12 }}>{status}</p> : null}
    </div>
  );
};

export { AuthPage };
export default AuthPage;

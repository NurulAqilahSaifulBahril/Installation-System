"use client";

import { FormEvent, useEffect, useState } from "react";
import { LoaderCircle, LogIn, UserPlus } from "lucide-react";

export default function LoginPage() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/setup")
      .then((response) => response.json())
      .then((payload: { needsSetup?: boolean }) =>
        setNeedsSetup(Boolean(payload.needsSetup)),
      )
      .catch(() => setNeedsSetup(false));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const endpoint = needsSetup ? "/api/auth/setup" : "/api/auth/login";
    const body = needsSetup
      ? { username, displayName, password }
      : { username, password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Could not sign in.");
        setBusy(false);
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Could not reach the server. Is the database connection up?");
      setBusy(false);
    }
  }

  const ready = needsSetup !== null;
  const submittable =
    username.trim().length > 0 &&
    password.length > 0 &&
    (!needsSetup || displayName.trim().length > 0);

  return (
    <div className="login-layout">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/eternalgy-logo.png" alt="Eternalgy" />
          <h1>Installation Operations</h1>
          <p>
            {!ready
              ? "Checking setup…"
              : needsSetup
                ? "First run — create the IT Admin account"
                : "Sign in to continue"}
          </p>
        </div>

        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
            disabled={!ready}
          />
        </label>

        {needsSetup && (
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Shown in the audit log"
            />
          </label>
        )}

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={needsSetup ? "new-password" : "current-password"}
            disabled={!ready}
          />
        </label>

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="button primary full"
          type="submit"
          disabled={busy || !ready || !submittable}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : needsSetup ? (
            <UserPlus size={16} />
          ) : (
            <LogIn size={16} />
          )}
          {busy
            ? needsSetup
              ? "Creating account…"
              : "Signing in…"
            : needsSetup
              ? "Create admin account"
              : "Sign in"}
        </button>
      </form>
    </div>
  );
}

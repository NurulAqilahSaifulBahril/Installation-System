"use client";

import { FormEvent, useEffect, useState } from "react";
import { Database, LoaderCircle, LogIn, UserPlus } from "lucide-react";

export default function LoginPage() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Connection settings have to be reachable from here, not just from the
  // dashboard. Signing in is itself a database call, so a machine with no
  // connection yet can never get past this screen to the settings dialog
  // behind it — which is exactly how a fresh install ends up stuck.
  const [isDesktop, setIsDesktop] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [connectionSaved, setConnectionSaved] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connection, setConnection] = useState({
    url: "",
    database: "",
    token: "",
    sourceUrl: "",
    sourceDatabase: "",
    sourceToken: "",
  });

  useEffect(() => {
    const desktop = window.installationDesktop;
    if (!desktop) return;
    setIsDesktop(true);
    void desktop.getSettings().then((current) => {
      setConnection((form) => ({
        ...form,
        url: current.url,
        database: current.database,
        sourceUrl: current.sourceUrl,
        sourceDatabase: current.sourceDatabase,
      }));
      // Nothing stored yet is the fresh-install case, so open the panel
      // rather than making someone hunt for it behind a sign-in they
      // cannot complete.
      if (!current.url || !current.database) setShowConnection(true);
    });
  }, []);

  async function saveConnection() {
    const desktop = window.installationDesktop;
    if (!desktop || connectionBusy) return;
    setConnectionBusy(true);
    setConnectionError(null);
    try {
      const result = await desktop.saveSettings(connection);
      if (!result.ok) {
        setConnectionError(result.message);
        setConnectionBusy(false);
        return;
      }
      // Reload rather than just closing the panel: the setup check above ran
      // against the old (absent) connection, so its answer is stale now.
      setConnectionSaved(true);
      window.location.reload();
    } catch (saveError) {
      setConnectionError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the connection settings.",
      );
      setConnectionBusy(false);
    }
  }

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

      {isDesktop && (
        <div className="login-card login-connection">
          <button
            type="button"
            className="button secondary full"
            onClick={() => setShowConnection((open) => !open)}
          >
            <Database size={16} />
            {showConnection ? "Hide connection settings" : "Connection settings"}
          </button>

          {showConnection && (
            <>
              <p className="login-hint">
                Where this computer reads and saves data. Ask whoever set up
                the system for these — signing in needs them.
              </p>

              <label>
                Address
                <input
                  value={connection.url}
                  onChange={(event) =>
                    setConnection({ ...connection, url: event.target.value })
                  }
                  placeholder="https://…/api/sql"
                />
              </label>

              <label>
                Database name
                <input
                  value={connection.database}
                  onChange={(event) =>
                    setConnection({ ...connection, database: event.target.value })
                  }
                />
              </label>

              <label>
                Access token
                <input
                  type="password"
                  value={connection.token}
                  onChange={(event) =>
                    setConnection({ ...connection, token: event.target.value })
                  }
                  placeholder="Leave blank to keep the stored one"
                />
              </label>

              <p className="login-hint">
                Source database — the read-only business data the pipeline is
                built from. Leave blank to use the same connection above.
              </p>

              <label>
                Source address
                <input
                  value={connection.sourceUrl}
                  onChange={(event) =>
                    setConnection({ ...connection, sourceUrl: event.target.value })
                  }
                  placeholder="Same as above"
                />
              </label>

              <label>
                Source database name
                <input
                  value={connection.sourceDatabase}
                  onChange={(event) =>
                    setConnection({
                      ...connection,
                      sourceDatabase: event.target.value,
                    })
                  }
                  placeholder="Same as above"
                />
              </label>

              <label>
                Source access token
                <input
                  type="password"
                  value={connection.sourceToken}
                  onChange={(event) =>
                    setConnection({ ...connection, sourceToken: event.target.value })
                  }
                  placeholder="Leave blank to keep the stored one"
                />
              </label>

              {connectionError && (
                <p className="login-error" role="alert">
                  {connectionError}
                </p>
              )}

              <button
                type="button"
                className="button primary full"
                onClick={() => void saveConnection()}
                disabled={connectionBusy || connectionSaved}
              >
                {connectionBusy || connectionSaved ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Database size={16} />
                )}
                {connectionBusy || connectionSaved
                  ? "Saving…"
                  : "Save connection"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

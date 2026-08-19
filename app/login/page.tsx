"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Database,
  Eye,
  EyeOff,
  LoaderCircle,
  LogIn,
  UserPlus,
} from "lucide-react";

export default function LoginPage() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Connection settings have to be reachable from here, not just from the
  // dashboard. Signing in is itself a database call, so a machine with no
  // connection yet can never get past this screen to the settings dialog
  // behind it — which is exactly how a fresh install ends up stuck. A build
  // that ships credentials never opens this panel; it exists for the key-free
  // installer, where nothing is stored yet.
  //
  // On a machine that is already connected the panel stays out of sight
  // entirely: it shows which server and database the office runs on to anyone
  // who opens the app, and offers to repoint them, both before anyone has
  // signed in. Whoever is signed in can still change the connection from the
  // dashboard, so hiding it here costs nothing on a working machine — and
  // connectionTrouble below brings it back when signing in fails for a reason
  // that looks like the connection, so a wrong or stale one is still fixable
  // from the one screen you can reach without it.
  const [isDesktop, setIsDesktop] = useState(false);
  const [needsConnection, setNeedsConnection] = useState(false);
  const [connectionTrouble, setConnectionTrouble] = useState(false);
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
    void desktop
      .getSettings()
      .then((current) => {
        setConnection((form) => ({
          ...form,
          url: current.url,
          database: current.database,
          sourceUrl: current.sourceUrl,
          sourceDatabase: current.sourceDatabase,
        }));
        // Nothing stored yet is the fresh-install case, so open the panel
        // rather than making someone hunt for it behind a sign-in they
        // cannot complete. A half-filled connection counts as unconfigured —
        // an address with no token cannot sign anyone in either.
        return Boolean(current.url && current.database && current.hasToken);
      })
      // If we cannot even read the stored settings we do not know whether this
      // machine is configured. Treating that as unconfigured keeps a fresh
      // install fixable; the other way would hide the only control that could
      // rescue it.
      .catch(() => false)
      .then((configured) => {
        setNeedsConnection(!configured);
        if (!configured) setShowConnection(true);
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
      // Reload rather than just closing the panel: the setup check below ran
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
      .catch(() => {
        // This check is itself a database call, so failing it means the
        // connection is unusable — surface the panel rather than leaving a
        // sign-in button that cannot work.
        setNeedsSetup(false);
        setConnectionTrouble(true);
      });
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
        // 401 is a wrong username or password — the connection worked fine to
        // find that out. Anything else (503 from a failed query, a proxy
        // error) points at the connection itself, so offer the panel.
        if (response.status !== 401) setConnectionTrouble(true);
        setBusy(false);
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Could not reach the server. Is the database connection up?");
      setConnectionTrouble(true);
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
          {/* Typing a password blind is where most failed sign-ins here come
              from — this is a shared office machine, not a public site. */}
          <div className="login-password">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={needsSetup ? "new-password" : "current-password"}
              disabled={!ready}
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowPassword((shown) => !shown)}
              disabled={!ready}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
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

      {isDesktop && (needsConnection || connectionTrouble) && (
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

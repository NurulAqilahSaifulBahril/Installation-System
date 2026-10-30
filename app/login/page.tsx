"use client";

import { FormEvent, useEffect, useState } from "react";
import SidebarCalendar from "@/app/components/SidebarCalendar";
import type { CalendarDayDetail } from "@/lib/types";
import {
  DEFAULT_WEATHER_COORDINATES,
  MALAYSIA_PUBLIC_HOLIDAYS,
  fetchDailyWeather,
  type DailyWeather,
} from "@/lib/calendar-weather";
import {
  Database,
  Eye,
  EyeOff,
  LoaderCircle,
  LogIn,
  ShieldCheck,
  Smartphone,
  UserPlus,
  Users,
} from "lucide-react";

export default function LoginPage() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [loginRole, setLoginRole] = useState<"admin" | "staff">("admin");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Staff phone + dummy 6-digit OTP state
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [dummyOtpSent, setDummyOtpSent] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [isDesktop, setIsDesktop] = useState(false);
  const [needsConnection, setNeedsConnection] = useState(false);
  const [connectionTrouble, setConnectionTrouble] = useState(false);
  const [showConnection, setShowConnection] = useState(false);

  const [weather, setWeather] = useState<Record<string, DailyWeather>>({});
  const [pickedDate, setPickedDate] = useState("");
  const [dayDetails, setDayDetails] = useState<
    Record<string, CalendarDayDetail>
  >({});

  useEffect(() => {
    let cancelled = false;
    void fetchDailyWeather([DEFAULT_WEATHER_COORDINATES]).then((next) => {
      if (!cancelled) setWeather(next);
    });
    void fetch("/api/public/calendar")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload?.dayDetails) setDayDetails(payload.dayDetails);
      })
      .catch(() => {
        // Already empty; nothing to undo.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        return Boolean(current.url && current.database && current.hasToken);
      })
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
        setNeedsSetup(false);
        setConnectionTrouble(true);
      });
  }, []);

  function handleSendDummyOtp() {
    const digits = phone.replace(/\D+/g, "");
    if (digits.length < 8) {
      setError("Please enter your phone number first.");
      return;
    }
    setError(null);
    const code = "123456";
    setDummyOtpSent(code);
    setOtp(code);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const isStaffLogin = !needsSetup && loginRole === "staff";
    const endpoint = needsSetup ? "/api/auth/setup" : "/api/auth/login";
    const body = needsSetup
      ? { username, displayName, password }
      : isStaffLogin
        ? { mode: "staff", phone, otp }
        : { mode: "admin", username, password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Could not sign in.");
        if (response.status !== 401 && response.status !== 400) {
          setConnectionTrouble(true);
        }
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
  const isStaffMode = !needsSetup && loginRole === "staff";
  const submittable = isStaffMode
    ? phone.replace(/\D+/g, "").length >= 8 && /^\d{6}$/.test(otp.trim())
    : username.trim().length > 0 &&
      password.length > 0 &&
      (!needsSetup || displayName.trim().length > 0);

  return (
    <div className="login-layout">
      <div className="login-panels">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/eternalgy-logo.png" alt="Eternalgy" />
            <h1>Scheduling Operations</h1>
            <p>
              {!ready
                ? "Checking setup…"
                : needsSetup
                  ? "First run — create the Admin account"
                  : "Sign in to continue"}
            </p>
          </div>

          {/* Inside the card, under the heading and above the first field. Its
              day and month buttons are explicitly type="button" (see
              SidebarCalendar) — untyped, they would submit this form. */}
          <aside className="login-calendar" aria-label="Calendar">
            <SidebarCalendar
              dayDetails={dayDetails}
              weather={weather}
              holidays={MALAYSIA_PUBLIC_HOLIDAYS}
              selectedDate={pickedDate}
              onSelectDate={setPickedDate}
            />
          </aside>

          {!needsSetup && (
            <div
              role="tablist"
              aria-label="Sign in role"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
                padding: "4px",
                borderRadius: "10px",
                background: "var(--surface-soft, #f1f5f9)",
                border: "1px solid var(--line, #e2e8f0)",
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={loginRole === "admin"}
                onClick={() => {
                  setLoginRole("admin");
                  setError(null);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  height: "36px",
                  borderRadius: "7px",
                  border:
                    loginRole === "admin"
                      ? "1px solid rgba(37, 99, 235, 0.3)"
                      : "1px solid transparent",
                  background:
                    loginRole === "admin"
                      ? "#2563eb"
                      : "transparent",
                  color:
                    loginRole === "admin"
                      ? "#ffffff"
                      : "var(--muted, #64748b)",
                  fontSize: "0.88rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow:
                    loginRole === "admin"
                      ? "0 1px 3px rgba(37, 99, 235, 0.25)"
                      : "none",
                  transition: "all 0.15s ease",
                }}
              >
                <ShieldCheck size={16} />
                Admin
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={loginRole === "staff"}
                onClick={() => {
                  setLoginRole("staff");
                  setError(null);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  height: "36px",
                  borderRadius: "7px",
                  border:
                    loginRole === "staff"
                      ? "1px solid rgba(37, 99, 235, 0.3)"
                      : "1px solid transparent",
                  background:
                    loginRole === "staff"
                      ? "#2563eb"
                      : "transparent",
                  color:
                    loginRole === "staff"
                      ? "#ffffff"
                      : "var(--muted, #64748b)",
                  fontSize: "0.88rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow:
                    loginRole === "staff"
                      ? "0 1px 3px rgba(37, 99, 235, 0.25)"
                      : "none",
                  transition: "all 0.15s ease",
                }}
              >
                <Users size={16} />
                Staff
              </button>
            </div>
          )}

          {isStaffMode ? (
            <>
              <label>
                Phone number
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value);
                      setDummyOtpSent(null);
                    }}
                    placeholder="e.g. 012-345 6789"
                    autoComplete="tel"
                    autoFocus
                    disabled={!ready}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    onClick={handleSendDummyOtp}
                    disabled={!ready || phone.replace(/\D+/g, "").length < 8}
                    style={{ whiteSpace: "nowrap", padding: "0 12px" }}
                  >
                    <Smartphone size={15} />
                    Get OTP
                  </button>
                </div>
              </label>

              <label>
                6-digit OTP
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(event) =>
                    setOtp(event.target.value.replace(/\D+/g, "").slice(0, 6))
                  }
                  placeholder="123456"
                  autoComplete="one-time-code"
                  disabled={!ready}
                  style={{
                    letterSpacing: "0.25em",
                    fontWeight: 600,
                    fontSize: "1rem",
                  }}
                />
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: dummyOtpSent ? "#16a34a" : "var(--muted, #64748b)",
                    fontWeight: dummyOtpSent ? 600 : 400,
                  }}
                >
                  {dummyOtpSent
                    ? `Dummy OTP filled: ${dummyOtpSent}`
                    : "Dummy OTP for now — enter any 6 digits (e.g. 123456)"}
                </span>
              </label>
            </>
          ) : (
            <>
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
                <div className="login-password">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={
                      needsSetup ? "new-password" : "current-password"
                    }
                    disabled={!ready}
                  />
                  <button
                    type="button"
                    className="login-password-toggle"
                    onClick={() => setShowPassword((shown) => !shown)}
                    disabled={!ready}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    aria-pressed={showPassword}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            </>
          )}

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
                : isStaffMode
                  ? "Sign in with OTP"
                  : "Sign in"}
          </button>
        </form>
      </div>

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

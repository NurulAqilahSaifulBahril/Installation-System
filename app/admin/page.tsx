"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "staff";
  isActive: boolean;
  createdAt: string;
  lastSeenAt: string | null;
};

type AuditEntry = {
  id: number;
  username: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  login_failed: "Failed sign-in",
  job_updated: "Job updated",
  ops_state_updated: "Planning data updated",
  user_created: "User created",
  user_updated: "User updated",
};

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export default function AdminPage() {
  const [me, setMe] = useState<AdminUser | null>(null);
  const [authState, setAuthState] = useState<"loading" | "denied" | "ok">(
    "loading",
  );

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [draft, setDraft] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "staff" as "admin" | "staff",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [auditPage, setAuditPage] = useState(0);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterSearch, setFilterSearch] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (response) => {
        // Only a 401 is a real sign-out. A 503 (database unreachable) left
        // through here would bounce an admin with a valid session to the login
        // screen — see the same guard on the dashboard.
        if (response.status !== 401 && !response.ok) return;
        if (!response.ok) throw new Error("unauthenticated");
        const payload = (await response.json()) as { user: AdminUser | null };
        if (!payload.user) throw new Error("unauthenticated");
        if (payload.user.role !== "admin") {
          setAuthState("denied");
          return;
        }
        setMe(payload.user);
        setAuthState("ok");
      })
      .catch(() => {
        window.location.href = "/login";
      });
  }, []);

  const loadUsers = useCallback(() => {
    fetch("/api/admin/users")
      .then(async (response) => {
        const payload = (await response.json()) as {
          users?: AdminUser[];
          error?: string;
        };
        if (!response.ok || !payload.users) {
          throw new Error(payload.error || "Could not load users.");
        }
        setUsers(payload.users);
        setUsersError(null);
      })
      .catch((error: Error) => setUsersError(error.message));
  }, []);

  const loadAudit = useCallback(
    (page: number) => {
      setAuditBusy(true);
      const params = new URLSearchParams();
      if (filterUser) params.set("username", filterUser);
      if (filterAction) params.set("action", filterAction);
      if (filterSearch) params.set("search", filterSearch);
      params.set("page", String(page));

      fetch(`/api/admin/audit-log?${params.toString()}`)
        .then(async (response) => {
          const payload = (await response.json()) as {
            entries?: AuditEntry[];
            hasMore?: boolean;
            error?: string;
          };
          if (!response.ok || !payload.entries) {
            throw new Error(payload.error || "Could not load audit log.");
          }
          setEntries(payload.entries);
          setAuditHasMore(Boolean(payload.hasMore));
          setAuditPage(page);
          setAuditError(null);
        })
        .catch((error: Error) => setAuditError(error.message))
        .finally(() => setAuditBusy(false));
    },
    [filterUser, filterAction, filterSearch],
  );

  useEffect(() => {
    if (authState !== "ok") return;
    loadUsers();
    loadAudit(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setCreateError(payload.error || "Could not create user.");
        return;
      }
      setDraft({ username: "", displayName: "", password: "", role: "staff" });
      loadUsers();
      loadAudit(0);
    } catch {
      setCreateError("Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  async function patchUser(id: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      window.alert(payload.error || "Could not update user.");
      return;
    }
    loadUsers();
    loadAudit(0);
  }

  function resetPassword(user: AdminUser) {
    const next = window.prompt(
      `New password for ${user.username} (6+ characters):`,
    );
    if (!next) return;
    if (next.length < 6) {
      window.alert("Password must be at least 6 characters.");
      return;
    }
    void patchUser(user.id, { password: next });
  }

  if (authState === "loading") {
    return (
      <div className="login-layout">
        <LoaderCircle className="spin" />
      </div>
    );
  }

  if (authState === "denied") {
    return (
      <div className="login-layout">
        <div className="login-card">
          <h1>IT Admin</h1>
          <p>
            Your account does not have admin access. Ask an IT Admin to raise
            your role if you need it.
          </p>
          <a className="button secondary full" href="/">
            <ArrowLeft size={15} />
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <div className="admin-heading">
        <div>
          <h1>
            <ShieldCheck size={22} style={{ verticalAlign: "-4px" }} /> IT Admin
          </h1>
          <p>
            User accounts and the change audit log. Signed in as{" "}
            {me?.displayName || me?.username}.
          </p>
        </div>
        <a className="button secondary" href="/">
          <ArrowLeft size={15} />
          Back to dashboard
        </a>
      </div>

      <section className="admin-panel">
        <h2>Users</h2>
        {usersError && (
          <p className="login-error" role="alert">
            {usersError}
          </p>
        )}
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Display name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last seen</th>
                <th>Created</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.username}</strong>
                  </td>
                  <td>{user.displayName}</td>
                  <td>
                    <span className={`admin-badge role-${user.role}`}>
                      {user.role === "admin" ? "IT Admin" : "Staff"}
                    </span>
                  </td>
                  <td>
                    {user.isActive ? (
                      <span className="admin-badge role-staff">Active</span>
                    ) : (
                      <span className="admin-badge inactive">Deactivated</span>
                    )}
                  </td>
                  <td className="audit-time">{formatTime(user.lastSeenAt)}</td>
                  <td className="audit-time">{formatTime(user.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => resetPassword(user)}
                      >
                        <KeyRound size={14} />
                        Reset password
                      </button>
                      {user.id !== me?.id && (
                        <>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() =>
                              void patchUser(user.id, {
                                role: user.role === "admin" ? "staff" : "admin",
                              })
                            }
                          >
                            {user.role === "admin" ? "Make staff" : "Make admin"}
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() =>
                              void patchUser(user.id, {
                                isActive: !user.isActive,
                              })
                            }
                          >
                            {user.isActive ? "Deactivate" : "Reactivate"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form className="admin-form-row" onSubmit={handleCreate}>
          <label>
            Username
            <input
              value={draft.username}
              onChange={(event) =>
                setDraft({ ...draft, username: event.target.value })
              }
            />
          </label>
          <label>
            Display name
            <input
              value={draft.displayName}
              onChange={(event) =>
                setDraft({ ...draft, displayName: event.target.value })
              }
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={draft.password}
              onChange={(event) =>
                setDraft({ ...draft, password: event.target.value })
              }
              autoComplete="new-password"
            />
          </label>
          <label>
            Role
            <select
              value={draft.role}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  role: event.target.value as "admin" | "staff",
                })
              }
            >
              <option value="staff">Staff</option>
              <option value="admin">IT Admin</option>
            </select>
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={
              creating ||
              !draft.username.trim() ||
              !draft.displayName.trim() ||
              draft.password.length < 6
            }
          >
            {creating ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <UserPlus size={15} />
            )}
            Create user
          </button>
        </form>
        {createError && (
          <p className="login-error" role="alert">
            {createError}
          </p>
        )}
      </section>

      <section className="admin-panel">
        <h2>Audit log</h2>
        <div className="admin-audit-filters">
          <select
            value={filterUser}
            onChange={(event) => setFilterUser(event.target.value)}
            aria-label="Filter by user"
          >
            <option value="">All users</option>
            {users.map((user) => (
              <option value={user.username} key={user.id}>
                {user.username}
              </option>
            ))}
          </select>
          <select
            value={filterAction}
            onChange={(event) => setFilterAction(event.target.value)}
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={filterSearch}
            onChange={(event) => setFilterSearch(event.target.value)}
            placeholder="Search summaries…"
            aria-label="Search audit log"
          />
          <button
            type="button"
            className="button secondary"
            onClick={() => loadAudit(0)}
            disabled={auditBusy}
          >
            {auditBusy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Apply
          </button>
        </div>

        {auditError && (
          <p className="login-error" role="alert">
            {auditError}
          </p>
        )}

        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>What changed</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && !auditBusy ? (
                <tr>
                  <td colSpan={4} className="run-all-complete">
                    No audit entries match these filters yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="audit-time">{formatTime(entry.createdAt)}</td>
                    <td>
                      <strong>{entry.username}</strong>
                    </td>
                    <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                    <td>{entry.summary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="row-actions">
          <button
            type="button"
            className="button secondary"
            disabled={auditBusy || auditPage === 0}
            onClick={() => loadAudit(auditPage - 1)}
          >
            Newer
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={auditBusy || !auditHasMore}
            onClick={() => loadAudit(auditPage + 1)}
          >
            Older
          </button>
        </div>
      </section>
    </div>
  );
}

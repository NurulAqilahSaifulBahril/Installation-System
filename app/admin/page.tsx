"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ClipboardList,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";

type AdminUser = {
  id: string;
  username: string;
  phone?: string;
  displayName: string;
  role: "admin" | "staff";
  pageAccess?: string;
  isActive: boolean;
  createdAt: string;
  lastSeenAt: string | null;
};

const PRESET_OPTIONS = [
  { value: "all", label: "All Pages" },
  { value: "groups,delivery,project", label: "Project Team, Installation & Delivery" },
  { value: "groups,delivery", label: "Installation & Delivery" },
  { value: "groups,delivery,own", label: "Installation & Delivery (Own Name Only)" },
  { value: "groups", label: "Installation Schedule Only" },
  { value: "groups,own", label: "Installation Schedule (Own Name Only)" },
  { value: "delivery", label: "Delivery Schedule Only" },
  { value: "delivery,own", label: "Delivery Schedule (Own Name Only)" },
  { value: "project", label: "Project Team Only" },
  { value: "warehouse", label: "Warehouse Only" },
] as const;

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
  const [activeTab, setActiveTab] = useState<"users" | "audit">("users");

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [draft, setDraft] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "staff" as "admin" | "staff",
    pageAccess: "all",
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
      setDraft({ username: "", displayName: "", password: "", role: "staff", pageAccess: "all" });
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
          <h1>Admin</h1>
          <p>
            Your account does not have admin access. Ask an Admin to raise
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
            <ShieldCheck size={22} style={{ verticalAlign: "-4px" }} /> Admin
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

      <div
        role="tablist"
        aria-label="Admin sections"
        style={{
          display: "flex",
          gap: "8px",
          borderBottom: "1px solid var(--line)",
          paddingBottom: "2px",
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "users"}
          onClick={() => setActiveTab("users")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
            fontSize: "0.9rem",
            fontWeight: 600,
            background: activeTab === "users" ? "var(--surface)" : "transparent",
            color: activeTab === "users" ? "var(--ink)" : "var(--muted)",
            border: "1px solid",
            borderColor: activeTab === "users" ? "var(--line)" : "transparent",
            borderBottom: activeTab === "users" ? "2px solid #2563eb" : "none",
            borderRadius: "8px 8px 0 0",
            cursor: "pointer",
          }}
        >
          <Users size={16} />
          Users ({users.length})
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "audit"}
          onClick={() => setActiveTab("audit")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
            fontSize: "0.9rem",
            fontWeight: 600,
            background: activeTab === "audit" ? "var(--surface)" : "transparent",
            color: activeTab === "audit" ? "var(--ink)" : "var(--muted)",
            border: "1px solid",
            borderColor: activeTab === "audit" ? "var(--line)" : "transparent",
            borderBottom: activeTab === "audit" ? "2px solid #2563eb" : "none",
            borderRadius: "8px 8px 0 0",
            cursor: "pointer",
          }}
        >
          <ClipboardList size={16} />
          Audit Log
        </button>
      </div>

      {activeTab === "users" && (
        <section className="admin-panel">
          {usersError && (
            <p className="login-error" role="alert">
              {usersError}
            </p>
          )}

          {(
            [
              {
                key: "admin",
                title: "Admins (Can Edit)",
                list: users.filter((u) => u.role === "admin"),
                emptyText: "No admin accounts found.",
              },
              {
                key: "staff",
                title: "Staff (View Only)",
                list: users.filter((u) => u.role === "staff"),
                emptyText: "No staff accounts yet.",
              },
            ] as const
          ).map((group, idx) => (
            <div
              key={group.key}
              style={{ marginTop: idx > 0 ? "24px" : "0" }}
            >
              <h2
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "10px",
                }}
              >
                {group.title}
                <span
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "999px",
                    background:
                      group.key === "admin"
                        ? "rgba(59, 108, 176, 0.14)"
                        : "var(--surface-soft)",
                    color:
                      group.key === "admin"
                        ? "var(--accent, #3b6cb0)"
                        : "var(--muted)",
                  }}
                >
                  {group.list.length}
                </span>
              </h2>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Phone number</th>
                      <th>Display name</th>
                      <th>Role</th>
                      <th>Page Access</th>
                      <th>Status</th>
                      <th>Last seen</th>
                      <th>Created</th>
                      <th aria-label="Actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.list.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          style={{
                            textAlign: "center",
                            padding: "18px",
                            color: "var(--muted)",
                            fontStyle: "italic",
                          }}
                        >
                          {group.emptyText}
                        </td>
                      </tr>
                    ) : (
                      group.list.map((user) => {
                        const phoneOrUser = user.phone || user.username;
                        return (
                        <tr key={user.id}>
                          <td>
                            <input
                              type="text"
                              defaultValue={phoneOrUser}
                              key={`${user.id}-phone-${phoneOrUser}`}
                              placeholder="e.g. 012-345 6789"
                              title="Click to edit phone number"
                              aria-label={`Phone number for ${user.displayName || user.username}`}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              onBlur={(e) => {
                                const nextVal = e.target.value.trim();
                                if (nextVal && nextVal !== phoneOrUser) {
                                  void patchUser(
                                    user.id,
                                    user.role === "staff"
                                      ? { phone: nextVal, username: nextVal }
                                      : { phone: nextVal },
                                  );
                                } else {
                                  e.target.value = phoneOrUser;
                                }
                              }}
                              style={{
                                height: "28px",
                                padding: "0 8px",
                                borderRadius: "6px",
                                border: "1px solid transparent",
                                background: "transparent",
                                color: "var(--ink)",
                                fontSize: "13px",
                                fontWeight: 600,
                                width: "100%",
                                minWidth: "130px",
                              }}
                              onFocus={(e) => {
                                e.currentTarget.style.borderColor = "var(--line)";
                                e.currentTarget.style.background = "var(--surface)";
                              }}
                              onBlurCapture={(e) => {
                                e.currentTarget.style.borderColor = "transparent";
                                e.currentTarget.style.background = "transparent";
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              defaultValue={user.displayName}
                              key={`${user.id}-${user.displayName}`}
                              title="Display name (used to match 'Own Name Only' schedules)"
                              aria-label={`Display name for ${user.username}`}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              onBlur={(e) => {
                                const nextName = e.target.value.trim();
                                if (nextName && nextName !== user.displayName) {
                                  void patchUser(user.id, { displayName: nextName });
                                } else {
                                  e.target.value = user.displayName;
                                }
                              }}
                              style={{
                                height: "28px",
                                padding: "0 8px",
                                borderRadius: "6px",
                                border: "1px solid transparent",
                                background: "transparent",
                                color: "var(--ink)",
                                fontSize: "13px",
                                width: "100%",
                                minWidth: "130px",
                              }}
                              onFocus={(e) => {
                                e.currentTarget.style.borderColor = "var(--line)";
                                e.currentTarget.style.background = "var(--surface)";
                              }}
                              onBlurCapture={(e) => {
                                e.currentTarget.style.borderColor = "transparent";
                                e.currentTarget.style.background = "transparent";
                              }}
                            />
                          </td>
                          <td>
                            <select
                              value={user.role}
                              onChange={(e) => {
                                const newRole = e.target.value as "admin" | "staff";
                                if (user.id === me?.id && newRole === "staff") {
                                  window.alert("You cannot demote your own account.");
                                  return;
                                }
                                void patchUser(user.id, { role: newRole });
                              }}
                              disabled={user.id === me?.id}
                              title={
                                user.id === me?.id
                                  ? "You cannot demote your own account"
                                  : "Change user role"
                              }
                              className={`admin-badge role-${user.role}`}
                              style={{
                                height: "28px",
                                padding: "0 8px",
                                borderRadius: "999px",
                                fontSize: "12px",
                                fontWeight: 600,
                                border: "1px solid var(--line)",
                                cursor: user.id === me?.id ? "not-allowed" : "pointer",
                                opacity: user.id === me?.id ? 0.75 : 1,
                                background:
                                  user.role === "admin"
                                    ? "rgba(59, 108, 176, 0.14)"
                                    : "var(--surface-soft)",
                                color:
                                  user.role === "admin"
                                    ? "var(--accent, #3b6cb0)"
                                    : "var(--muted)",
                                outline: "none",
                              }}
                              aria-label={`Role for ${user.username}`}
                            >
                              <option value="staff">Staff (View Only)</option>
                              <option value="admin">Admin (Can Edit)</option>
                            </select>
                          </td>
                          <td>
                            <select
                              value={user.pageAccess || "all"}
                              onChange={(e) => void patchUser(user.id, { pageAccess: e.target.value })}
                              style={{
                                height: "28px",
                                padding: "0 8px",
                                borderRadius: "6px",
                                border: "1px solid var(--line)",
                                background: "var(--surface)",
                                color: "var(--ink)",
                                fontSize: "12px",
                                fontWeight: 500,
                                cursor: "pointer",
                                outline: "none",
                              }}
                              title="Change page access"
                              aria-label={`Page access for ${user.username}`}
                            >
                              {PRESET_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                              {user.pageAccess &&
                                user.pageAccess !== "all" &&
                                !PRESET_OPTIONS.some((o) => o.value === user.pageAccess) && (
                                  <option value={user.pageAccess}>
                                    Custom ({user.pageAccess})
                                  </option>
                                )}
                            </select>
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
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

        <form className="admin-form-row" onSubmit={handleCreate}>
          <label>
            Phone number
            <input
              type="tel"
              placeholder="e.g. 012-345 6789"
              value={draft.username}
              onChange={(event) =>
                setDraft({ ...draft, username: event.target.value })
              }
            />
          </label>
          <label>
            Display name
            <input
              placeholder="e.g. Mun"
              value={draft.displayName}
              onChange={(event) =>
                setDraft({ ...draft, displayName: event.target.value })
              }
            />
          </label>
          {draft.role === "admin" && (
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
          )}
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
              <option value="staff">Staff (View Only)</option>
              <option value="admin">Admin (Can Edit)</option>
            </select>
          </label>
          <label>
            Page Access
            <select
              value={draft.pageAccess}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  pageAccess: event.target.value,
                })
              }
            >
              {PRESET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={
              creating ||
              !draft.username.trim() ||
              !draft.displayName.trim() ||
              (draft.role === "admin" && draft.password.length < 6)
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
      )}

      {activeTab === "audit" && (
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
      )}
    </div>
  );
}

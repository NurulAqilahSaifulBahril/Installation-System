"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { toTitleCase } from "@/lib/title-case";
import styles from "./warehouse.module.css";

// The Admin tab of the Inventory Management page: add a user and read the audit log.
// Users are Inventory Management's own (warehouse_users, not the Scheduling system's
// accounts). Names are picked from prod_main (/api/warehouse/people) and checked again on
// the server (/api/warehouse/users); the audit log is Inventory Management's
// own (/api/warehouse/audit), separate from the Scheduling Operation system's. Both check
// for a signed-in admin on the server, so nothing here grants access by itself.

// Admin can open every page; Staff can open every page except Admin.
const PRESET_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Staff" },
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

// An Inventory Management user (its own table, not the Scheduling system's accounts).
type AdminUser = {
  id: string;
  name: string;
  username: string;
  phone: string;
  pageAccess: string;
  isActive: boolean;
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" });
}

export default function AdminTab() {
  const [section, setSection] = useState<"users" | "add" | "audit">("users");

  // ---- add user: the name must be one from prod_main ----
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  // What is typed in the Name box, and the prod_main person it was matched to (if any).
  const [nameQuery, setNameQuery] = useState("");
  const [picked, setPicked] = useState<{ name: string; phone: string } | null>(null);
  const [suggestions, setSuggestions] = useState<{ name: string; phone: string }[]>([]);
  const [searching, setSearching] = useState(false);
  // Sign-in here is by phone number and OTP, so users added from this tab are staff accounts
  // with no password. Admin accounts need a password and are added in the dashboard.
  const [pageAccess, setPageAccess] = useState("staff");
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Search prod_main as the admin types (after a short pause).
  useEffect(() => {
    const term = nameQuery.trim();
    if (picked || term.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/warehouse/people?q=${encodeURIComponent(term)}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as { people?: { name: string; phone: string }[]; error?: string };
        if (cancelled) return;
        if (response.status === 401 || response.status === 403) {
          setFormMessage({ ok: false, text: "Only a signed-in dashboard admin can search names." });
          return;
        }
        setSuggestions(response.ok ? (body.people ?? []) : []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [nameQuery, picked]);

  function pickPerson(person: { name: string; phone: string }) {
    setPicked(person);
    setNameQuery(toTitleCase(person.name));
    setSuggestions([]);
    // Start from the phone number prod_main has; the admin can still change it.
    if (person.phone) setPhone(person.phone);
    setFormMessage(null);
  }

  async function addUser(event: FormEvent) {
    event.preventDefault();
    setFormMessage(null);
    if (!picked) {
      setFormMessage({ ok: false, text: "Pick a name from the list. Only names in prod_main can be added." });
      return;
    }
    if (username.trim().length < 2) {
      setFormMessage({ ok: false, text: "Enter a username of 2 or more characters." });
      return;
    }
    if (!phone.trim()) {
      setFormMessage({ ok: false, text: "Enter the phone number to use for the OTP." });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/warehouse/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: picked.name, username: username.trim(), phone: phone.trim(), pageAccess }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
      if (response.status === 401 || response.status === 403) {
        throw new Error("Only a signed-in dashboard admin can add users.");
      }
      if (!response.ok) throw new Error(body.error || "Could not add the user.");
      setFormMessage({ ok: true, text: `Added ${toTitleCase(picked.name)}.` });
      // Record it in the Inventory Management audit log (separate from the Scheduling system's).
      void fetch("/api/warehouse/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "user_created",
          entityType: "warehouse_user",
          entityId: typeof body.id === "string" ? body.id : undefined,
          summary: `Added user "${toTitleCase(picked.name)}" (username ${username.trim()}, ${phone.trim()}, access: ${pageAccess})`,
        }),
      }).catch(() => {});
      setPhone("");
      setUsername("");
      setNameQuery("");
      setPicked(null);
      void loadUsers();
    } catch (error) {
      setFormMessage({ ok: false, text: error instanceof Error ? error.message : "Could not add the user." });
    } finally {
      setSaving(false);
    }
  }

  // ---- users: view and edit ----
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersBusy, setUsersBusy] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ username: "", phone: "", pageAccess: "staff", isActive: true });
  const [editMessage, setEditMessage] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setUsersBusy(true);
    setUsersError(null);
    try {
      const response = await fetch("/api/warehouse/users", { credentials: "same-origin", cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { users?: AdminUser[]; error?: string };
      if (response.status === 401 || response.status === 403) {
        throw new Error("Only a signed-in dashboard admin can see users.");
      }
      if (!response.ok) throw new Error(body.error || "Could not load users.");
      setUsers(body.users ?? []);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Could not load users.");
    } finally {
      setUsersBusy(false);
    }
  }, []);

  function startEdit(user: AdminUser) {
    setEditMessage(null);
    setEditingId(user.id);
    setDraft({ username: user.username, phone: user.phone, pageAccess: user.pageAccess === "admin" ? "admin" : "staff", isActive: user.isActive });
  }

  async function saveEdit(user: AdminUser) {
    const patch: Record<string, unknown> = {};
    const changes: string[] = [];
    const newUsername = draft.username.trim();
    if (newUsername && newUsername !== user.username) {
      patch.username = newUsername;
      changes.push("username");
    }
    const newPhone = draft.phone.trim();
    if (newPhone && newPhone !== user.phone) {
      patch.phone = newPhone;
      changes.push("phone");
    }
    if (draft.pageAccess !== user.pageAccess) {
      patch.pageAccess = draft.pageAccess;
      changes.push("page access");
    }
    if (draft.isActive !== user.isActive) {
      patch.isActive = draft.isActive;
      changes.push(draft.isActive ? "activated" : "deactivated");
    }
    if (changes.length === 0) {
      setEditingId(null);
      return;
    }
    setUsersBusy(true);
    setEditMessage(null);
    try {
      const response = await fetch(`/api/warehouse/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(patch),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not save the changes.");
      void fetch("/api/warehouse/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "user_updated",
          entityType: "warehouse_user",
          entityId: user.id,
          summary: `Updated user "${toTitleCase(user.name)}": ${changes.join(", ")}`,
        }),
      }).catch(() => {});
      setEditingId(null);
      await loadUsers();
    } catch (err) {
      setEditMessage(err instanceof Error ? err.message : "Could not save the changes.");
      setUsersBusy(false);
    }
  }

  useEffect(() => {
    if (section === "users") void loadUsers();
  }, [section, loadUsers]);

  // ---- audit log ----
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async (nextPage: number, term: string, append: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(nextPage) });
      if (term.trim()) params.set("search", term.trim());
      const response = await fetch(`/api/warehouse/audit?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        entries?: AuditEntry[];
        hasMore?: boolean;
        error?: string;
      };
      if (response.status === 401 || response.status === 403) {
        throw new Error("Only a signed-in dashboard admin can read the audit log.");
      }
      if (!response.ok) throw new Error(body.error || "Could not load the audit log.");
      setEntries((prev) => (append ? [...prev, ...(body.entries ?? [])] : (body.entries ?? [])));
      setHasMore(Boolean(body.hasMore));
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the audit log.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (section === "audit") void load(0, search, false);
    // Load when the audit section opens; searching is done with the button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  return (
    <section className={styles.screen} aria-labelledby="warehouse-admin">
      <h1 id="warehouse-admin" className={styles.sectionTitle} style={{ margin: "0 0 12px", fontSize: "24px", fontWeight: 700, color: "#000" }}>
        Admin
      </h1>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "14px" }}>
        <div className={styles.txFilterPills} role="tablist" aria-label="Admin sections">
          {(
            [
              ["users", "Users"],
              ["audit", "Audit log"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              className={`${styles.txPill} ${section === id ? styles.txPillActive : ""}`}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.txPill} ${section === "add" ? styles.txPillActive : ""}`}
          style={{ fontSize: "20px", lineHeight: 1, padding: "4px 14px" }}
          aria-label="Add user"
          title="Add user"
          aria-pressed={section === "add"}
          onClick={() => setSection("add")}
        >
          +
        </button>
      </div>

      {section === "users" && (
        <div>
          {usersError && <p className={styles.note} style={{ color: "#b91c1c" }}>{usersError}</p>}
          {editMessage && <p className={styles.note} style={{ color: "#b91c1c" }}>{editMessage}</p>}
          <div className={styles.tableWrap}>
            <table className={`${styles.detailTable} ${styles.mountTable}`}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Username</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Page access</th>
                  <th scope="col">Status</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{usersBusy ? "Loading…" : usersError ? "—" : "No users."}</td>
                  </tr>
                ) : (
                  users.map((user) =>
                    editingId === user.id ? (
                      <tr key={user.id}>
                        <td>{toTitleCase(user.name)}</td>
                        <td>
                          <input
                            type="text"
                            className={`${styles.scannerInput} ${styles.transferField} ${styles.adminField}`}
                            style={{ minWidth: 0, height: "42px" }}
                            value={draft.username}
                            onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
                            aria-label="Username"
                          />
                        </td>
                        <td>
                          <input
                            type="tel"
                            className={`${styles.scannerInput} ${styles.transferField} ${styles.adminField}`}
                            style={{ minWidth: 0, height: "42px" }}
                            value={draft.phone}
                            onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                            aria-label="Phone"
                          />
                        </td>
                        <td>
                          <select
                            className={`${styles.bankingAccountSelect} ${styles.adminField}`}
                            value={draft.pageAccess}
                            onChange={(e) => setDraft((d) => ({ ...d, pageAccess: e.target.value }))}
                            aria-label="Page access"
                          >
                            {PRESET_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <input
                              type="checkbox"
                              checked={draft.isActive}
                              onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                            />
                            Active
                          </label>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button type="button" className={styles.btnActionGhost} disabled={usersBusy} onClick={() => void saveEdit(user)}>
                            Save
                          </button>{" "}
                          <button type="button" className={styles.btnActionGhost} onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={user.id}>
                        <td>{toTitleCase(user.name)}</td>
                        <td>{user.username || "—"}</td>
                        <td>{user.phone}</td>
                        <td>{PRESET_OPTIONS.find((option) => option.value === user.pageAccess)?.label ?? user.pageAccess}</td>
                        <td>{user.isActive ? "Active" : "Disabled"}</td>
                        <td>
                          <button type="button" className={styles.btnActionGhost} onClick={() => startEdit(user)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ),
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === "add" && (
        <form className={styles.inspectCard} onSubmit={addUser} aria-label="Add user">
          <div className={styles.mountForm} style={{ alignItems: "start" }}>
            <label className={`${styles.bankingFieldLabel} ${styles.adminLabel}`} style={{ position: "relative" }}>
              Name
              <input
                type="text"
                autoComplete="off"
                className={`${styles.scannerInput} ${styles.transferField} ${styles.adminField}`}
                style={{ minWidth: 0, height: "42px" }}
                value={nameQuery}
                placeholder="Type to search prod_main"
                onChange={(e) => {
                  setNameQuery(e.target.value);
                  setPicked(null);
                }}
              />
              {/* The results float over the form, so the other boxes never move or grow */}
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, marginTop: "4px" }}>
                {!picked && suggestions.length > 0 && (
                  <ul
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                      border: "1px solid var(--line)",
                      borderRadius: "8px",
                      background: "var(--surface)",
                      maxHeight: "220px",
                      overflowY: "auto",
                      boxShadow: "0 6px 16px rgba(0, 0, 0, 0.12)",
                    }}
                  >
                    {suggestions.map((person) => (
                      <li key={`${person.name}|${person.phone}`}>
                        <button
                          type="button"
                          onClick={() => pickPerson(person)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            background: "transparent",
                            border: 0,
                            font: "inherit",
                            fontSize: "14px",
                            fontWeight: 500,
                            color: "#000",
                            cursor: "pointer",
                          }}
                        >
                          {toTitleCase(person.name)}
                          {person.phone ? ` · ${person.phone}` : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!picked && searching && <span style={{ display: "block", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)", fontSize: "11px", fontWeight: 500, color: "var(--muted)" }}>Searching…</span>}
                {!picked && !searching && nameQuery.trim().length >= 2 && suggestions.length === 0 && (
                  <span style={{ display: "block", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)", fontSize: "11px", fontWeight: 500, color: "var(--muted)" }}>
                    No matching name in prod_main.
                  </span>
                )}
              </div>
            </label>
            <label className={`${styles.bankingFieldLabel} ${styles.adminLabel}`}>
              Username
              <input
                type="text"
                autoComplete="off"
                className={`${styles.scannerInput} ${styles.transferField} ${styles.adminField}`}
                style={{ minWidth: 0, height: "42px" }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className={`${styles.bankingFieldLabel} ${styles.adminLabel}`}>
              Phone number
              <input
                type="tel"
                inputMode="tel"
                className={`${styles.scannerInput} ${styles.transferField} ${styles.adminField}`}
                style={{ minWidth: 0, height: "42px" }}
                value={phone}
                placeholder="012-345 6789"
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className={`${styles.bankingFieldLabel} ${styles.adminLabel}`}>
              Page access
              <select
                className={`${styles.bankingAccountSelect} ${styles.adminField}`}
                value={pageAccess}
                onChange={(e) => setPageAccess(e.target.value)}
              >
                {PRESET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {formMessage && (
            <p className={styles.note} style={{ color: formMessage.ok ? "var(--green)" : "#b91c1c", margin: "8px 0 0" }}>
              {formMessage.text}
            </p>
          )}
          <div style={{ marginTop: "12px" }}>
            <button type="submit" className={styles.btnActionPrimary} disabled={saving}>
              {saving ? "Adding…" : "Add user"}
            </button>
          </div>
        </form>
      )}

      {section === "audit" && (
        <div>
          <form
            style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}
            onSubmit={(e) => {
              e.preventDefault();
              void load(0, search, false);
            }}
          >
            <input
              type="search"
              className={styles.tableSearch}
              style={{ width: "auto", minWidth: "240px", marginTop: 0, height: "42px" }}
              placeholder="Search the log"
              aria-label="Search the audit log"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit" className={styles.btnActionGhost} disabled={busy}>
              Search
            </button>
            <button type="button" className={styles.btnActionGhost} disabled={busy} onClick={() => void load(0, search, false)}>
              Refresh
            </button>
          </form>

          {error && <p className={styles.note} style={{ color: "#b91c1c" }}>{error}</p>}

          <div className={styles.tableWrap}>
            <table className={`${styles.detailTable} ${styles.mountTable}`}>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">User</th>
                  <th scope="col">Action</th>
                  <th scope="col">Summary</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={4}>{busy ? "Loading…" : error ? "—" : "No entries."}</td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatTime(entry.createdAt)}</td>
                      <td>{entry.username}</td>
                      <td>{entry.action}</td>
                      <td>{entry.summary}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div style={{ marginTop: "10px" }}>
              <button type="button" className={styles.btnActionGhost} disabled={busy} onClick={() => void load(page + 1, search, true)}>
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

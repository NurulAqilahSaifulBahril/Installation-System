import type { AppUser } from "@/lib/auth";
import { queryProxy } from "@/lib/proxy-db";

// Best-effort by design: an audit write must never turn a successful save
// into a failed request. Failures are swallowed after a console note.
export async function writeAuditLog(entry: {
  user: AppUser | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  details?: unknown;
}) {
  try {
    await queryProxy(
      [
        "insert into public.app_audit_log (user_id, username, action, entity_type, entity_id, summary, details)",
        "values ($1, $2, $3, $4, $5, $6, $7::jsonb)",
      ].join("\n"),
      [
        entry.user?.id ?? null,
        entry.user?.username ?? "unknown",
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.summary,
        JSON.stringify(entry.details ?? {}),
      ],
    );
  } catch (error) {
    console.error("audit log write failed:", error);
  }
}

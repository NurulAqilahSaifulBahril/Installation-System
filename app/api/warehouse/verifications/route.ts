import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { requireUser } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";
import { toTitleCase } from "@/lib/title-case";
import { ensureAuditTable, ensureVerificationsTable, MATERIALS } from "@/lib/warehouse-verifications";
import { ensureWarehouseUsersTable } from "@/lib/warehouse-users";

export const dynamic = "force-dynamic";

// Stock Out verification records.
//  - GET: every record (job, material, who, when). Needs a dashboard session, like the
//    booked-job data it belongs to.
//  - POST: record that a material was completed, or the whole job verified, by the person
//    who signed in to Inventory Management. The name comes from the Inventory Management
//    user registered for the phone number the page sends (else the dashboard account's
//    name) and is also written to the Inventory Management audit log.
// The Inventory Management sign-in does not verify the OTP yet, so the name recorded is the
// one the person signed in as.

function authFailure(error: unknown) {
  const status = error instanceof AuthError ? error.status : 401;
  const message = error instanceof AuthError ? error.message : "Not signed in.";
  return NextResponse.json({ error: message }, { status });
}

type VerificationRow = { job_ref: string; material: string; username: string; created_at: string };

export async function GET() {
  try {
    await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  try {
    await ensureVerificationsTable();
    const rows = await queryProxy<VerificationRow>(
      [
        "select job_ref, material, username, created_at",
        "from public.warehouse_verifications",
        "order by created_at desc",
        "limit 5000",
      ].join(String.fromCharCode(10)),
    );
    return NextResponse.json({
      records: rows.map((row) => ({
        jobRef: row.job_ref,
        material: row.material,
        by: row.username,
        at: row.created_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the verification records." },
      { status: 503 },
    );
  }
}

const postSchema = z.object({
  jobRef: z.string().min(1).max(100),
  material: z.enum(MATERIALS),
  phone: z.string().max(50).optional(),
});

const MATERIAL_LABEL: Record<string, string> = {
  job: "the whole job",
  panel: "Panel",
  inverter: "Inverter",
  battery: "Battery",
  mounting: "Mounting Structure",
  electrical: "Electrical Accessories",
};

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return authFailure(error);
  }

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "jobRef and material are required." }, { status: 400 });
  const { jobRef, material } = parsed.data;

  try {
    await ensureVerificationsTable();
    await ensureAuditTable();

    // Who: the Inventory Management user for this phone number, else the dashboard account.
    let name = toTitleCase(user.displayName || user.username);
    let userId: string = user.id;
    const digits = (parsed.data.phone ?? "").split("").filter((ch) => ch >= "0" && ch <= "9").join("");
    if (digits.length >= 7) {
      await ensureWarehouseUsersTable();
      const found = await queryProxy<{ id: string; username: string | null; name: string }>(
        [
          "select id, username, name from public.warehouse_users",
          "where is_active and regexp_replace(phone, '[^0-9]', '', 'g') = $1",
          "limit 1",
        ].join(String.fromCharCode(10)),
        [digits],
      );
      if (found[0]) {
        name = found[0].username || found[0].name;
        userId = found[0].id;
      }
    }

    // First time only: a later repeat does not overwrite who did it.
    const inserted = await queryProxy<{ id: string }>(
      [
        "insert into public.warehouse_verifications (job_ref, material, username, user_id)",
        "values ($1, $2, $3, $4)",
        "on conflict (job_ref, material) do nothing",
        "returning id",
      ].join(String.fromCharCode(10)),
      [jobRef, material, name, userId],
    );
    if (inserted.length > 0) {
      await queryProxy(
        [
          "insert into public.warehouse_audit_log (user_id, username, action, entity_type, entity_id, summary)",
          "values ($1, $2, $3, $4, $5, $6)",
        ].join(String.fromCharCode(10)),
        [
          userId,
          name,
          material === "job" ? "stock_out_verified" : "material_completed",
          "stock_out",
          jobRef,
          material === "job"
            ? `Verified Stock Out ${jobRef}`
            : `Completed ${MATERIAL_LABEL[material]} for Stock Out ${jobRef}`,
        ],
      );
    }
    return NextResponse.json({ ok: true, by: name, recorded: inserted.length > 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not record the verification." },
      { status: 503 },
    );
  }
}

import { NextResponse } from "next/server";
import { queryProxy } from "@/lib/proxy-db";

export const dynamic = "force-dynamic";

export type HrLeaveRow = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  employee_username: string | null;
  employee_phone: string | null;
  staff_role: string | null;
  type: string | null;
  from_date: string | null;
  to_date: string | null;
  note: string | null;
  has_mc: boolean | null;
  status: string | null;
  reviewed_by: string | null;
  updated_at: string | null;
};

export type HrPersonRow = {
  id: string;
  name: string | null;
  username: string | null;
  phone: string | null;
  staff_role: string | null;
  user_status: string | null;
};

export async function GET() {
  try {
    const [leaves, people] = await Promise.all([
      queryProxy<HrLeaveRow>(
        `SELECT
           l.id,
           l.employee_id,
           p.name AS employee_name,
           p.username AS employee_username,
           p.phone AS employee_phone,
           p.staff_role,
           l.type,
           l.from_date,
           l.to_date,
           l.note,
           l.has_mc,
           l.status,
           l.reviewed_by,
           l.updated_at::text AS updated_at
         FROM public.hr_leaves l
         LEFT JOIN public.hr_people p ON p.id = l.employee_id
         ORDER BY l.from_date DESC NULLS LAST, l.updated_at DESC NULLS LAST`,
      ),
      queryProxy<HrPersonRow>(
        `SELECT id, name, username, phone, staff_role, user_status
         FROM public.hr_people
         WHERE COALESCE(LOWER(user_status), 'active') = 'active'
         ORDER BY id ASC`,
      ),
    ]);

    return NextResponse.json({
      ok: true,
      database: process.env.PG_PROXY_DATABASE || "NUrul_DB",
      leaves,
      people,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to read hr_leaves from NUrul_DB.",
        leaves: [],
        people: [],
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const body = (raw.record && typeof raw.record === "object" ? raw.record : raw) as Record<string, unknown>;

    const action = (raw.action || body.action) as string | undefined;
    const leaveId = (body.id || raw.id) as string | undefined;

    if (action === "delete" && leaveId) {
      await queryProxy(`DELETE FROM public.hr_leaves WHERE id = $1`, [leaveId]);
      return NextResponse.json({ ok: true, deleted: leaveId });
    }

    const employeeName = (body.employeeName || body.employee_name || "") as string;
    let empId = (body.employeeId || body.employee_id || "") as string;

    if (!empId && employeeName) {
      const match = await queryProxy<{ id: string }>(
        `SELECT id FROM public.hr_people
         WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) OR LOWER(TRIM(username)) = LOWER(TRIM($1))
         LIMIT 1`,
        [employeeName],
      );
      if (match.length > 0) {
        empId = match[0].id;
      } else {
        empId = `emp-${Date.now()}`;
        await queryProxy(
          `INSERT INTO public.hr_people (id, name, username, user_status, staff_role, created_at, updated_at)
           VALUES ($1, $2, $2, 'active', 'project_team', NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [empId, employeeName],
        );
      }
    }

    const finalLeaveId = leaveId || `leave-${Date.now()}`;
    const fromDate = ((body.fromDate || body.from_date || new Date().toISOString().slice(0, 10)) as string).slice(0, 10);
    const toDate = ((body.toDate || body.to_date || fromDate) as string).slice(0, 10);
    const hasMc = Boolean(body.hasMc ?? body.has_mc);
    const leaveType = (body.type || (hasMc ? "Medical Leave" : "Annual Leave")) as string;
    const note = ((body.note ?? null) || null) as string | null;
    const status = (body.status || "approved") as string;

    await queryProxy(
      `INSERT INTO public.hr_leaves (id, employee_id, type, from_date, to_date, note, has_mc, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id) DO UPDATE SET
         employee_id = EXCLUDED.employee_id,
         type = EXCLUDED.type,
         from_date = EXCLUDED.from_date,
         to_date = EXCLUDED.to_date,
         note = EXCLUDED.note,
         has_mc = EXCLUDED.has_mc,
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [finalLeaveId, empId, leaveType, fromDate, toDate, note, hasMc, status],
    );

    return NextResponse.json({ ok: true, id: finalLeaveId });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to save hr_leaves in NUrul_DB.",
      },
      { status: 500 },
    );
  }
}


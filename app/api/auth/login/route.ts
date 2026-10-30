import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import {
  createSession,
  findOrCreateStaffByPhone,
  findUserByUsername,
  normalizePhone,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const adminLoginSchema = z.object({
  mode: z.literal("admin").optional(),
  username: z.string().min(1),
  password: z.string().min(1),
});

const staffLoginSchema = z.object({
  mode: z.literal("staff"),
  phone: z.string().min(1),
  otp: z.string().min(1),
});

export async function POST(request: Request) {
  const rawBody = await request.json().catch(() => null);

  if (rawBody && typeof rawBody === "object" && rawBody.mode === "staff") {
    const parsedStaff = staffLoginSchema.safeParse(rawBody);
    if (!parsedStaff.success) {
      return NextResponse.json(
        { error: "Enter your phone number and 6-digit OTP." },
        { status: 400 },
      );
    }

    const cleanDigits = normalizePhone(parsedStaff.data.phone);
    if (cleanDigits.length < 8) {
      return NextResponse.json(
        { error: "Please enter a valid phone number." },
        { status: 400 },
      );
    }

    const cleanOtp = parsedStaff.data.otp.trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      return NextResponse.json(
        { error: "Please enter a valid 6-digit OTP." },
        { status: 401 },
      );
    }

    try {
      const user = await findOrCreateStaffByPhone(parsedStaff.data.phone);
      if (!user || !user.isActive) {
        await writeAuditLog({
          user: null,
          action: "login_failed",
          entityType: "auth",
          summary: `Failed staff OTP sign-in attempt for phone "${parsedStaff.data.phone}"`,
        });
        return NextResponse.json(
          { error: "This staff account is deactivated. Please contact an Admin." },
          { status: 401 },
        );
      }

      const token = await createSession(user.id);
      await writeAuditLog({
        user,
        action: "login",
        entityType: "auth",
        summary: `${user.displayName || user.username} signed in via Staff Phone OTP (${parsedStaff.data.phone})`,
      });

      const response = NextResponse.json({
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          pageAccess: user.pageAccess || "all",
        },
      });
      response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
      return response;
    } catch (error) {
      return NextResponse.json(
        {
          error:
            "Could not sign in: " +
            (error instanceof Error ? error.message : "unknown error"),
        },
        { status: 503 },
      );
    }
  }

  const parsed = adminLoginSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a username and password." },
      { status: 400 },
    );
  }

  try {
    const user = await findUserByUsername(parsed.data.username);
    // One generic message for wrong user, wrong password, and deactivated
    // account — no probing which usernames exist.
    if (
      !user ||
      !user.isActive ||
      !verifyPassword(parsed.data.password, user.passwordHash)
    ) {
      await writeAuditLog({
        user: null,
        action: "login_failed",
        entityType: "auth",
        summary: `Failed sign-in attempt for "${parsed.data.username}"`,
      });
      return NextResponse.json(
        { error: "Incorrect username or password." },
        { status: 401 },
      );
    }

    const token = await createSession(user.id);
    await writeAuditLog({
      user,
      action: "login",
      entityType: "auth",
      summary: `${user.displayName || user.username} signed in`,
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        pageAccess: user.pageAccess || "all",
      },
    });
    response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          "Could not sign in: " +
          (error instanceof Error ? error.message : "unknown error"),
      },
      { status: 503 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { fetchJobFiles } from "@/lib/source-api";

export const dynamic = "force-dynamic";

// One customer's SLD drawing, roof photos and site-assessment photos, read on
// demand when someone opens them on Customer Scheduling. Kept out of /api/jobs
// on purpose: that response carries every invoice, and the links for all of
// them would be megabytes of data almost nobody opens.
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    await requireUser();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json({ error: "Not signed in." }, { status });
  }

  try {
    const files = await fetchJobFiles(id);
    if (!files) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    return NextResponse.json(files);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          "Could not load the photos: " +
          (error instanceof Error ? error.message : "unknown error"),
      },
      { status: 503 },
    );
  }
}

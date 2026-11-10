import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { AuthError, requireUser } from '@/lib/auth';
import { invalidateJobsCache } from '@/lib/jobs-cache';
import { invalidateOpsStateCache } from '@/lib/ops-state-cache';
import { readOpsState } from '@/lib/ops-store';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requireUser();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json(
      {
        success: false,
        error:
          status === 403
            ? 'Not allowed to sync schedule.'
            : 'Not signed in.',
      },
      { status },
    );
  }
  try {
    const scriptPath = path.join(process.cwd(), 'scripts', 'sync_google_schedule.py');
    console.log('[Schedule Sync API] Executing sync script:', scriptPath);

    // Railway's Linux image only ships python3 (see railpack.json); Windows
    // installs name it python
    const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
    const { stdout, stderr } = await execFileAsync(pythonBin, ['-u', scriptPath], {
      cwd: process.cwd(),
      timeout: 180_000,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    console.log('[Schedule Sync API] Output:', stdout);
    if (stderr) console.warn('[Schedule Sync API] Stderr:', stderr);

    // Invalidate memory caches so next /api/jobs and /api/ops-state loads immediately get fresh synced data
    invalidateJobsCache();
    invalidateOpsStateCache();

    // Parse JSON result from script output
    let result = null;
    const match = stdout.match(/Final Result:\s*(\{[\s\S]*?\})/);
    if (match) {
      try {
        result = JSON.parse(match[1]);
      } catch (e) {
        console.error('Failed to parse final result JSON:', e);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Schedule synchronized successfully with latest Google Sheet data',
      result: result || {
        lastSynced: new Date().toISOString(),
      },
      stdout: stdout.slice(-1000),
    });
  } catch (error: any) {
    console.error('[Schedule Sync API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to synchronize schedule',
        stderr: error?.stderr,
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const { state } = await readOpsState();
    return NextResponse.json({
      success: true,
      lastScheduleSync: (state as any)?.lastScheduleSync || null,
      groupsCount: state.groups?.length || 0,
      draftPlacementsCount: (state.scheduleDraft as any)?.placements?.length || 0,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message },
      { status: 500 },
    );
  }
}

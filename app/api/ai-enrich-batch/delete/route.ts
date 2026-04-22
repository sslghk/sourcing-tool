import { NextRequest, NextResponse } from 'next/server';
import { userStore } from '@/lib/auth-store';
import { BATCH_JOBS_DIR, readJobState } from '@/lib/batch-worker';
import fs from 'fs';
import path from 'path';

const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'ABORTED']);

export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get('next-auth.session-token')?.value ||
                  request.cookies.get('__Secure-next-auth.session-token')?.value ||
                  request.cookies.get('authjs.session-token')?.value ||
                  request.cookies.get('__Secure-authjs.session-token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const adminEmail = request.headers.get('x-user-email');
    if (!adminEmail) {
      return NextResponse.json({ error: 'User email not provided' }, { status: 400 });
    }

    const admin = await userStore.findByEmail(adminEmail);
    if (!admin || !userStore.isAdminUser(admin)) {
      return NextResponse.json({ error: 'Only admin can delete batch job records' }, { status: 403 });
    }

    const { jobId } = await request.json();
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const state = readJobState(jobId);
    if (!state) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (!TERMINAL_STATES.has(state.overallState)) {
      return NextResponse.json({ error: 'Cannot delete a running job. Abort it first.' }, { status: 409 });
    }

    fs.unlinkSync(path.join(BATCH_JOBS_DIR, `${jobId}.json`));
    return NextResponse.json({ message: 'Job record deleted' });
  } catch (error) {
    console.error('Delete batch job error:', error);
    return NextResponse.json({ error: 'Failed to delete job record' }, { status: 500 });
  }
}

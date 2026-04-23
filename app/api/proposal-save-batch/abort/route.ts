import { NextRequest, NextResponse } from 'next/server';
import { readJobState, writeJobState, unlockProposal } from '@/lib/batch-worker';

export async function POST(request: NextRequest) {
  try {
    const { jobId } = await request.json();
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const state = readJobState(jobId);
    if (!state) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    if (state.jobType !== 'proposal-save') {
      return NextResponse.json({ error: 'Not a proposal-save job' }, { status: 400 });
    }

    if (!['FETCHING'].includes(state.overallState)) {
      return NextResponse.json({ error: `Cannot abort job in state: ${state.overallState}` }, { status: 409 });
    }

    state.overallState = 'ABORTED';
    state.completedAt = new Date().toISOString();
    writeJobState(jobId, state);
    unlockProposal(state.proposalId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[proposal-save-batch/abort] Error:', error);
    return NextResponse.json({ error: 'Failed to abort job', details: String(error) }, { status: 500 });
  }
}

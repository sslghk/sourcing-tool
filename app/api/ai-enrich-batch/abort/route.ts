import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { readJobState, writeJobState, unlockProposal, BATCH_JOBS_DIR } from '@/lib/batch-worker';
import { cancelBatchJob } from '@/lib/gemini-ai';

/**
 * POST /api/ai-enrich-batch/abort
 * Body: { proposalId: string }
 *
 * Cancels the active Gemini batch job(s) for a proposal,
 * marks the job state as FAILED/ABORTED, and unlocks the proposal.
 */
export async function POST(request: NextRequest) {
  try {
    const { proposalId } = await request.json();
    if (!proposalId) {
      return NextResponse.json({ error: 'proposalId required' }, { status: 400 });
    }

    const state = readJobState(proposalId);
    if (!state) {
      return NextResponse.json({ error: 'No batch job found for this proposal' }, { status: 404 });
    }

    if (state.overallState !== 'PHASE1_RUNNING' && state.overallState !== 'PHASE2_RUNNING') {
      return NextResponse.json({ error: 'Job is not currently running' }, { status: 409 });
    }

    // Attempt to cancel Gemini batch job(s) — best-effort, do not fail if API call errors
    const jobNamesToCancel: string[] = [];
    if (state.phase1JobName) jobNamesToCancel.push(state.phase1JobName);
    if (state.phase2JobName) jobNamesToCancel.push(state.phase2JobName);

    for (const name of jobNamesToCancel) {
      try {
        await cancelBatchJob(name);
        console.log(`Cancelled Gemini batch job: ${name}`);
      } catch (e) {
        console.warn(`Failed to cancel Gemini batch job ${name} (may already be complete):`, e);
      }
    }

    // Mark job as aborted and unlock proposal
    state.overallState = 'ABORTED';
    state.error = 'Aborted by user';
    state.completedAt = new Date().toISOString();
    writeJobState(proposalId, state);
    unlockProposal(proposalId);

    return NextResponse.json({ ok: true, message: 'Batch job aborted and proposal unlocked.' });
  } catch (error) {
    console.error('Abort batch job error:', error);
    return NextResponse.json({ error: 'Failed to abort job', details: String(error) }, { status: 500 });
  }
}

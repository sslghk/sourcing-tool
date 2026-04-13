import { NextRequest, NextResponse } from 'next/server';
import { readJobState, writeJobState, unlockProposal } from '@/lib/batch-worker';
import fs from 'fs';
import path from 'path';

const BATCH_JOBS_DIR = path.join(process.cwd(), 'data', 'batch-jobs');

/** DELETE /api/ai-enrich-batch/reset?proposalId=xxx
 *  Clears a failed (or completed) job state and unlocks the proposal,
 *  allowing the user to resubmit from the proposal page.
 */
export async function DELETE(request: NextRequest) {
  try {
    const proposalId = new URL(request.url).searchParams.get('proposalId');
    if (!proposalId) return NextResponse.json({ error: 'proposalId required' }, { status: 400 });

    const state = readJobState(proposalId);
    if (!state) return NextResponse.json({ error: 'No job found' }, { status: 404 });

    if (state.overallState === 'PHASE1_RUNNING' || state.overallState === 'PHASE2_RUNNING') {
      return NextResponse.json({ error: 'Cannot reset a running job' }, { status: 409 });
    }

    unlockProposal(proposalId);
    fs.unlinkSync(path.join(BATCH_JOBS_DIR, `${proposalId}.json`));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

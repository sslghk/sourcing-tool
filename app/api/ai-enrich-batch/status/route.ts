import { NextRequest, NextResponse } from 'next/server';
import { readJobState, advanceJobState, jobStateSummary } from '@/lib/batch-worker';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const proposalId = searchParams.get('proposalId');
    if (!proposalId) return NextResponse.json({ error: 'proposalId required' }, { status: 400 });

    const state = readJobState(proposalId);
    if (!state) return NextResponse.json({ error: 'No batch job found for this proposal' }, { status: 404 });

    const updated = await advanceJobState(state);
    return NextResponse.json(jobStateSummary(updated));

  } catch (error) {
    console.error('Batch status error:', error);
    return NextResponse.json({ error: 'Failed to check batch status', details: String(error) }, { status: 500 });
  }
}

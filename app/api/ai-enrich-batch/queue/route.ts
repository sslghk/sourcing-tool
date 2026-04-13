import { NextResponse } from 'next/server';
import { listAllJobStates, jobStateSummary } from '@/lib/batch-worker';

/** GET /api/ai-enrich-batch/queue — list all batch jobs (for the dashboard). */
export async function GET() {
  try {
    const jobs = listAllJobStates().map(jobStateSummary);
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Queue list error:', error);
    return NextResponse.json({ error: 'Failed to list jobs', details: String(error) }, { status: 500 });
  }
}

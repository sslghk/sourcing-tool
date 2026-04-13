import { NextResponse } from 'next/server';
import { processAllPendingJobs } from '@/lib/batch-worker';

/** POST /api/ai-enrich-batch/worker — advance all pending batch jobs.
 *  Call this from a cron job or the batch-jobs dashboard to progress jobs
 *  without requiring the user to keep a browser tab open.
 */
export async function POST() {
  try {
    const result = await processAllPendingJobs();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Batch worker error:', error);
    return NextResponse.json({ error: 'Worker failed', details: String(error) }, { status: 500 });
  }
}

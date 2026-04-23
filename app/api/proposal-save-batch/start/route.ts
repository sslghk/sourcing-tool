import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { BATCH_JOBS_DIR, lockProposal, writeJobState } from '@/lib/batch-worker';

const DATA_DIR = path.join(process.cwd(), 'data', 'proposals');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { proposalId, proposalTitle, products, initiatedBy } = body;

    if (!proposalId) {
      return NextResponse.json({ error: 'proposalId is required' }, { status: 400 });
    }
    if (!Array.isArray(products) || products.length === 0) {
      return NextResponse.json({ error: 'products array is required' }, { status: 400 });
    }

    const proposalFilePath = path.join(DATA_DIR, `${proposalId}.json`);
    if (!fs.existsSync(proposalFilePath)) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const existingData = JSON.parse(fs.readFileSync(proposalFilePath, 'utf-8'));
    if (existingData.locked) {
      return NextResponse.json(
        { error: 'Proposal is already locked by another job' },
        { status: 423 }
      );
    }

    const jobId = `${proposalId}-${Date.now()}`;
    const by = initiatedBy ?? null;

    fs.mkdirSync(BATCH_JOBS_DIR, { recursive: true });

    const state = {
      jobType: 'proposal-save',
      jobId,
      proposalId,
      proposalTitle: proposalTitle || existingData.proposalName || proposalId,
      overallState: 'FETCHING',
      products: products.map((p: any) => ({
        id: p.id,
        source_id: p.source_id,
        source: p.source,
        title: p.title,
      })),
      progress: { done: 0, total: products.length },
      initiatedBy: by,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      emailSentAt: null,
      emailError: null,
    };

    writeJobState(jobId, state);
    lockProposal(proposalId, jobId);

    console.log(`[proposal-save-batch] Started job ${jobId} for proposal ${proposalId} (${products.length} products)`);

    return NextResponse.json({ success: true, jobId, proposalId });
  } catch (error) {
    console.error('[proposal-save-batch/start] Error:', error);
    return NextResponse.json({ error: 'Failed to start batch save job', details: String(error) }, { status: 500 });
  }
}

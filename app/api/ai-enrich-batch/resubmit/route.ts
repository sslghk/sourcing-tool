import { NextRequest, NextResponse } from 'next/server';
import { readJobState, writeJobState, lockProposal } from '@/lib/batch-worker';
import { uploadBuffer, createBatchJob } from '@/lib/gemini-ai';
import { buildEnrichmentPrompt } from '@/lib/ai-enrich-prompts';

/** POST /api/ai-enrich-batch/resubmit
 *  Re-runs Phase 1 for a failed job using the already-stored product map
 *  (image URIs + user notes). No need to re-upload images or re-enter prompts.
 */
export async function POST(request: NextRequest) {
  try {
    const { proposalId } = await request.json();
    if (!proposalId) return NextResponse.json({ error: 'proposalId required' }, { status: 400 });

    const state = readJobState(proposalId);
    if (!state) return NextResponse.json({ error: 'No job found for this proposal' }, { status: 404 });

    if (state.overallState === 'PHASE1_RUNNING' || state.overallState === 'PHASE2_RUNNING') {
      return NextResponse.json({ error: 'Job is still running' }, { status: 409 });
    }

    const maxAIImages = Math.max(1, parseInt(process.env.MAX_AI_IMAGES ?? '4', 10));

    // Rebuild Phase 1 JSONL from stored productMap (images already in File API)
    const phase1Lines: string[] = [];
    const productMap = (state.productMap as any[]).map((entry: any, idx: number) => {
      const prompt = buildEnrichmentPrompt(maxAIImages, entry.userNotes || 'None provided');
      const imagePart = entry.imageFileUri
        ? { file_data: { mime_type: entry.imageMimeType, file_uri: entry.imageFileUri } }
        : null;

      const parts: any[] = [];
      if (imagePart) parts.push(imagePart);
      parts.push({ text: prompt + '\n\nPlease respond with valid JSON only, no additional text.' });

      phase1Lines.push(JSON.stringify({
        request: {
          contents: [{ parts }],
          generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 8192 },
        },
      }));

      return { ...entry, lineIndex: idx };
    });

    if (phase1Lines.length === 0) {
      return NextResponse.json({ error: 'No products with stored image URIs found in job state' }, { status: 400 });
    }

    const newJobId = `${proposalId}-${Date.now()}`;
    const jsonlBuf = Buffer.from(phase1Lines.join('\n'), 'utf-8');
    const jsonlFile = await uploadBuffer(jsonlBuf, 'text/plain', `${newJobId}-phase1-input.jsonl`);
    if (!jsonlFile.name) throw new Error('JSONL file upload returned no name');

    const phase1Job = await createBatchJob(
      'gemini-2.5-flash',
      jsonlFile.name,
      `ai-enrich-phase1-${proposalId}`,
    );

    // Reset state back to Phase 1
    state.jobId = newJobId;
    state.phase = 1;
    state.overallState = 'PHASE1_RUNNING';
    state.phase1JobName = phase1Job.name;
    state.phase2JobName = null;
    state.productMap = productMap;
    state.alternativeMap = [];
    state.concepts = {};
    state.error = null;
    state.completedAt = null;
    state.startedAt = new Date().toISOString();

    writeJobState(proposalId, state);
    lockProposal(proposalId, newJobId);

    return NextResponse.json({ ok: true, jobId: newJobId, productCount: phase1Lines.length });
  } catch (error) {
    console.error('Resubmit error:', error);
    return NextResponse.json({ error: 'Resubmit failed', details: String(error) }, { status: 500 });
  }
}

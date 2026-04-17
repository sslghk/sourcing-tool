import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { uploadBuffer, createBatchJob } from '@/lib/gemini-ai';
import { buildEnrichmentPrompt } from '@/lib/ai-enrich-prompts';
import { lockProposal } from '@/lib/batch-worker';

const BATCH_JOBS_DIR = path.join(process.cwd(), 'data', 'batch-jobs');
const DATA_DIR = path.join(process.cwd(), 'data', 'proposals');

export interface BatchProduct {
  productId: string;   // internal product.id
  sourceId: string;    // product.source_id (used as JSON key for persistence)
  imageUrl: string;
  userNotes: string;
}

export async function POST(request: NextRequest) {
  try {
    const { proposalId, proposalTitle = proposalId, products, selectedAIImages, initiatedBy }: { proposalId: string; proposalTitle?: string; products: BatchProduct[]; selectedAIImages?: Record<string, number[]>; initiatedBy?: { email: string; name: string } } = await request.json();

    if (!proposalId || !products?.length) {
      return NextResponse.json({ error: 'proposalId and products are required' }, { status: 400 });
    }

    const maxAIImages = Math.max(1, parseInt(process.env.MAX_AI_IMAGES ?? '4', 10));
    const jobId = `${proposalId}-${Date.now()}`;

    // ── Read existing proposal data to check for prior enrichments ────────────
    const proposalFile = path.join(DATA_DIR, `${proposalId}.json`);
    let existingEnrichments: Record<string, any> = {};
    if (fs.existsSync(proposalFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(proposalFile, 'utf-8'));
        existingEnrichments = data.aiEnrichments || {};
      } catch { /* ignore read errors */ }
    }

    // ── Build keepMap: which alternatives to preserve vs regenerate ───────────
    const keepMap: Record<string, {
      keptAlternatives: Array<{ index: number; alt: any }>;
      regenerateCount: number;
      startIndex: number;
    }> = {};

    for (const product of products) {
      const selectedIndices = selectedAIImages?.[product.productId] || [];
      const existing = existingEnrichments[product.sourceId]?.design_alternatives || [];

      // Keep selected alternatives that have generated images
      const kept: Array<{ index: number; alt: any }> = [];
      for (const idx of selectedIndices) {
        const alt = existing[idx];
        if (alt?.generated_image_url) {
          kept.push({ index: kept.length, alt }); // Re-index starting from 0
        }
      }

      const regenerateCount = Math.max(0, maxAIImages - kept.length);
      keepMap[product.productId] = {
        keptAlternatives: kept,
        regenerateCount,
        startIndex: kept.length,
      };
    }

    // ── Upload each product image to Gemini File API, build JSONL ─────────────
    const productMap: Array<{
      productId: string; sourceId: string; lineIndex: number;
      imageFileName: string; imageFileUri: string; imageMimeType: string;
      userNotes: string;
    }> = [];
    const phase1Lines: string[] = [];

    for (const product of products) {
      const prompt = buildEnrichmentPrompt(maxAIImages, product.userNotes || 'None provided');

      // Fetch image buffer
      let imageBuf: Buffer;
      let imageMimeType: string;
      try {
        const normalised = product.imageUrl.startsWith('//') ? `https:${product.imageUrl}` : product.imageUrl;
        const res = await fetch(normalised, {
          signal: AbortSignal.timeout(20000),
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*', Referer: 'https://www.taobao.com/' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        imageMimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
        imageBuf = Buffer.from(await res.arrayBuffer());
      } catch (e) {
        console.warn(`Could not fetch image for ${product.productId}, skipping:`, e);
        continue;
      }

      // Upload image to Gemini File API — returns { name: 'files/abc', uri: 'https://...' }
      const safeId = product.productId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const imageFile = await uploadBuffer(imageBuf, imageMimeType, `${jobId}-img-${safeId}`);
      if (!imageFile.uri || !imageFile.name) {
        console.warn(`File upload returned no URI for ${product.productId}, skipping`);
        continue;
      }

      // Each JSONL line is a raw generateContent request (Gemini batch format)
      const imagePart = { file_data: { mime_type: imageMimeType, file_uri: imageFile.uri } };
      productMap.push({
        productId: product.productId,
        sourceId: product.sourceId,
        lineIndex: phase1Lines.length,
        imageFileName: imageFile.name,
        imageFileUri: imageFile.uri,
        imageMimeType,
        userNotes: product.userNotes || '',
      });
      phase1Lines.push(JSON.stringify({
        request: {
          contents: [{ parts: [imagePart, { text: prompt + '\n\nPlease respond with valid JSON only, no additional text.' }] }],
          generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 8192 },
        },
      }));
    }

    if (phase1Lines.length === 0) {
      return NextResponse.json({ error: 'No valid products with uploadable images found' }, { status: 400 });
    }

    // ── Upload JSONL to Gemini File API (supports up to 2 GB) ────────────────
    const jsonlBuf = Buffer.from(phase1Lines.join('\n'), 'utf-8');
    const jsonlFile = await uploadBuffer(jsonlBuf, 'text/plain', `${jobId}-phase1-input.jsonl`);
    if (!jsonlFile.name) throw new Error('JSONL file upload returned no name');

    // ── Create Phase 1 batch job ──────────────────────────────────────────────
    const phase1Job = await createBatchJob(
      'gemini-2.5-flash',
      jsonlFile.name,
      `ai-enrich-phase1-${proposalId}`,
    );

    // ── Persist job state to disk ─────────────────────────────────────────────
    fs.mkdirSync(BATCH_JOBS_DIR, { recursive: true });
    const state = {
      proposalId,
      proposalTitle,
      jobId,
      phase: 1,
      overallState: 'PHASE1_RUNNING',
      phase1JobName: phase1Job.name,
      phase2JobName: null as string | null,
      productMap,
      alternativeMap: [] as any[],
      concepts: {} as Record<string, any>,
      keepMap, // Store which alternatives to keep vs regenerate
      error: null as string | null,
      completedAt: null as string | null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      initiatedBy: initiatedBy ?? null,
    };

    fs.writeFileSync(path.join(BATCH_JOBS_DIR, `${proposalId}.json`), JSON.stringify(state, null, 2));
    lockProposal(proposalId, jobId);

    return NextResponse.json({
      jobId,
      phase: 1,
      state: 'PHASE1_RUNNING',
      message: `Batch concept generation started for ${phase1Lines.length} products`,
    });

  } catch (error) {
    console.error('Batch start error:', error);
    return NextResponse.json({ error: 'Failed to start batch job', details: String(error) }, { status: 500 });
  }
}

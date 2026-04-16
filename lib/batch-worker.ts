import fs from 'fs';
import path from 'path';
import { getBatchJob, uploadBuffer, createBatchJob, downloadFileContent } from './gemini-ai';
import { JobState } from '@google/genai';
import { sendMail } from './mailer';

export const BATCH_JOBS_DIR = path.join(process.cwd(), 'data', 'batch-jobs');
const DATA_DIR    = path.join(process.cwd(), 'data', 'proposals');
const AI_IMAGES_DIR = path.join(process.cwd(), 'public', 'ai-images');

// ─── Email notification ───────────────────────────────────────────────────────

async function sendJobNotification(state: any): Promise<void> {
  const email: string | undefined = state.initiatedBy?.email;
  if (!email) return;
  const name: string = state.initiatedBy?.name || email;
  const title: string = state.proposalTitle || state.proposalId;
  const isComplete = state.overallState === 'COMPLETED';
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
  const proposalUrl = `${baseUrl}/proposals/${state.proposalId}`;
  const subject = isComplete
    ? `✅ AI Batch Job Completed – ${title}`
    : `❌ AI Batch Job Failed – ${title}`;
  const statusLine = isComplete
    ? 'Your batch AI enrichment job has <strong>completed successfully</strong>.'
    : `Your batch AI enrichment job has <strong>failed</strong>.<br>Reason: ${state.error ?? 'Unknown error'}`;
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:${isComplete ? '#16a34a' : '#dc2626'}">${isComplete ? '✅ Batch AI Job Completed' : '❌ Batch AI Job Failed'}</h2>
      <p>Hi ${name},</p>
      <p>${statusLine}</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:6px 12px;background:#f9fafb;font-weight:600;border:1px solid #e5e7eb">Proposal</td><td style="padding:6px 12px;border:1px solid #e5e7eb"><a href="${proposalUrl}" style="color:#0284c7">${title}</a></td></tr>
        <tr><td style="padding:6px 12px;background:#f9fafb;font-weight:600;border:1px solid #e5e7eb">Products</td><td style="padding:6px 12px;border:1px solid #e5e7eb">${state.productMap?.length ?? 0}</td></tr>
        <tr><td style="padding:6px 12px;background:#f9fafb;font-weight:600;border:1px solid #e5e7eb">Started</td><td style="padding:6px 12px;border:1px solid #e5e7eb">${new Date(state.startedAt).toLocaleString()}</td></tr>
        <tr><td style="padding:6px 12px;background:#f9fafb;font-weight:600;border:1px solid #e5e7eb">Finished</td><td style="padding:6px 12px;border:1px solid #e5e7eb">${new Date().toLocaleString()}</td></tr>
      </table>
      <a href="${proposalUrl}" style="display:inline-block;padding:10px 20px;background:#0284c7;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">View Proposal →</a>
      <p style="color:#6b7280;font-size:12px;margin-top:16px">${proposalUrl}</p>
    </div>`;
  const text = `Hi ${name},\n\n${
    isComplete
      ? `Your batch AI enrichment job for "${title}" has completed successfully.`
      : `Your batch AI enrichment job for "${title}" has failed.\nReason: ${state.error ?? 'Unknown error'}`
  }\n\nProducts: ${state.productMap?.length ?? 0}\nStarted: ${new Date(state.startedAt).toLocaleString()}\nFinished: ${new Date().toLocaleString()}\n\nView proposal: ${proposalUrl}`;
  try {
    await sendMail({ to: email, subject, text, html });
    console.log(`[batch-worker] Notification sent to ${email} (${state.overallState})`);
  } catch (e) {
    console.warn(`[batch-worker] Failed to send notification email to ${email}:`, e);
  }
}

const FAILED_STATES = new Set<JobState>([
  JobState.JOB_STATE_FAILED,
  JobState.JOB_STATE_CANCELLED,
  JobState.JOB_STATE_EXPIRED,
]);

// ─── State helpers ─────────────────────────────────────────────────────────────

export function readJobState(proposalId: string): any | null {
  const p = path.join(BATCH_JOBS_DIR, `${proposalId}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

export function writeJobState(proposalId: string, state: any): void {
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(BATCH_JOBS_DIR, { recursive: true });
  fs.writeFileSync(path.join(BATCH_JOBS_DIR, `${proposalId}.json`), JSON.stringify(state, null, 2));
}

export function listAllJobStates(): any[] {
  if (!fs.existsSync(BATCH_JOBS_DIR)) return [];
  return fs
    .readdirSync(BATCH_JOBS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(BATCH_JOBS_DIR, f), 'utf-8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

// ─── Proposal lock helpers ─────────────────────────────────────────────────────

export function lockProposal(proposalId: string, jobId: string): void {
  const filePath = path.join(DATA_DIR, `${proposalId}.json`);
  if (!fs.existsSync(filePath)) return;
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  data.locked = true;
  data.batchJobId = jobId;
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function unlockProposal(proposalId: string): void {
  const filePath = path.join(DATA_DIR, `${proposalId}.json`);
  if (!fs.existsSync(filePath)) return;
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  data.locked = false;
  data.batchJobId = null;
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ─── Image save helper ─────────────────────────────────────────────────────────

function saveImageToServer(base64: string, mimeType: string, proposalId: string, productId: string, index: number, generationId: string): string {
  const ext = mimeType.split('/')[1] ?? 'png';
  const safeId = productId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(AI_IMAGES_DIR, proposalId, safeId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `concept-${index}-${generationId}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, 'base64'));
  return `/ai-images/${proposalId}/${safeId}/${filename}`;
}

function parseJsonl(text: string): any[] {
  return text.split('\n').flatMap(line => {
    const t = line.trim();
    if (!t) return [];
    try { return [JSON.parse(t)]; } catch { return []; }
  });
}

// ─── Core phase-advancement logic ──────────────────────────────────────────────

/**
 * Checks the current batch job state and advances it to the next phase if ready.
 * Returns the (possibly updated) state.
 */
export async function advanceJobState(state: any): Promise<any> {
  const { proposalId } = state;

  // ── Phase 1 ────────────────────────────────────────────────────────────────
  if (state.overallState === 'PHASE1_RUNNING') {
    const job = await getBatchJob(state.phase1JobName);

    if (job.state === JobState.JOB_STATE_SUCCEEDED) {
      const outputFileName = (job as any).dest?.fileName as string | undefined;
      if (!outputFileName) {
        state.overallState = 'FAILED';
        state.error = 'Phase 1 completed but no output file name returned';
        unlockProposal(proposalId);
        writeJobState(proposalId, state);
        return state;
      }

      const outputText = await downloadFileContent(outputFileName);
      const lines = parseJsonl(outputText);
      console.log(`[batch-worker] Phase 1 output: ${lines.length} lines from ${outputFileName}`);
      if (lines.length > 0) {
        console.log('[batch-worker] Phase 1 first line keys:', Object.keys(lines[0]));
        console.log('[batch-worker] Phase 1 first line sample:', JSON.stringify(lines[0]).slice(0, 500));
      }
      const concepts: Record<string, any> = {};

      lines.forEach((entry, lineIndex) => {
        const mapping = state.productMap.find((m: any) => m.lineIndex === lineIndex);
        if (!mapping) {
          console.warn(`[batch-worker] Phase 1 line ${lineIndex}: no productMap mapping found`);
          return;
        }
        const responseRoot = entry.response ?? entry;
        if (entry.error) {
          console.warn(`[batch-worker] Phase 1 line ${lineIndex} (${mapping.productId}): API error:`, JSON.stringify(entry.error));
          return;
        }
        const text: string = responseRoot.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text ?? '';
        if (!text) {
          console.warn(`[batch-worker] Phase 1 line ${lineIndex} (${mapping.productId}): no text in response. responseRoot keys:`, Object.keys(responseRoot));
          return;
        }
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.warn(`[batch-worker] Phase 1 line ${lineIndex} (${mapping.productId}): text has no JSON block. text[:200]:`, text.slice(0, 200));
          return;
        }
        try { concepts[mapping.productId] = JSON.parse(jsonMatch[0]); }
        catch (e) { console.warn(`[batch-worker] Phase 1 line ${lineIndex} (${mapping.productId}): JSON.parse failed:`, e); }
      });
      console.log(`[batch-worker] Phase 1 parsed concepts for ${Object.keys(concepts).length}/${lines.length} products`);

      // Build Phase 2 JSONL
      const alternativeMap: Array<{ productId: string; sourceId: string; altIndex: number; lineIndex: number }> = [];
      const phase2Lines: string[] = [];

      for (const productEntry of state.productMap as any[]) {
        const conceptResult = concepts[productEntry.productId];
        if (!conceptResult?.design_alternatives) continue;

        const imagePart = productEntry.imageFileUri
          ? { file_data: { mime_type: productEntry.imageMimeType, file_uri: productEntry.imageFileUri } }
          : null;

        for (let altIndex = 0; altIndex < conceptResult.design_alternatives.length; altIndex++) {
          const alt = conceptResult.design_alternatives[altIndex];
          const imgPrompt = alt.generated_image_prompt ?? alt.concept_title ?? '';
          const parts: any[] = [];
          if (imagePart) parts.push(imagePart);
          parts.push({ text: `Generate a professional e-commerce product photo.\n\nDesign brief: ${imgPrompt}\n\nRequirements:\n- Same product type as reference\n- Apply ALL design changes in the brief\n- Pure white background, studio lighting\n- No text, no people, product fills the frame` });

          alternativeMap.push({ productId: productEntry.productId, sourceId: productEntry.sourceId, altIndex, lineIndex: phase2Lines.length });
          phase2Lines.push(JSON.stringify({
            request: {
              contents: [{ parts }],
              generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.8 },
            },
          }));
        }
      }

      if (phase2Lines.length === 0) {
        state.overallState = 'FAILED';
        state.error = 'Phase 1 returned no usable concepts';
        unlockProposal(proposalId);
        writeJobState(proposalId, state);
        return state;
      }

      const phase2Buf = Buffer.from(phase2Lines.join('\n'), 'utf-8');
      const phase2File = await uploadBuffer(phase2Buf, 'text/plain', `${state.jobId}-phase2-input.jsonl`);
      if (!phase2File.name) throw new Error('Phase 2 JSONL upload returned no name');

      const phase2Job = await createBatchJob('gemini-2.5-flash-image', phase2File.name, `ai-enrich-phase2-${proposalId}`);

      state.phase = 2;
      state.overallState = 'PHASE2_RUNNING';
      state.phase2JobName = phase2Job.name;
      state.alternativeMap = alternativeMap;
      state.concepts = concepts;
      writeJobState(proposalId, state);

    } else if (job.state && FAILED_STATES.has(job.state)) {
      state.overallState = 'FAILED';
      state.error = `Phase 1 job ended with state: ${job.state}`;
      unlockProposal(proposalId);
      writeJobState(proposalId, state);
      await sendJobNotification(state);
    }
  }

  // ── Phase 2 ────────────────────────────────────────────────────────────────
  else if (state.overallState === 'PHASE2_RUNNING') {
    const job = await getBatchJob(state.phase2JobName);

    if (job.state === JobState.JOB_STATE_SUCCEEDED) {
      const outputFileName = (job as any).dest?.fileName as string | undefined;
      if (!outputFileName) {
        state.overallState = 'FAILED';
        state.error = 'Phase 2 completed but no output file name returned';
        unlockProposal(proposalId);
        writeJobState(proposalId, state);
        await sendJobNotification(state);
        return state;
      }

      const outputText = await downloadFileContent(outputFileName);
      const lines = parseJsonl(outputText);
      const generationId = Date.now().toString(36);
      const savedImages: Record<string, string[]> = {};

      lines.forEach((entry, lineIndex) => {
        const mapping = state.alternativeMap.find((m: any) => m.lineIndex === lineIndex);
        if (!mapping) return;
        const responseRoot = entry.response ?? entry;
        const parts: any[] = responseRoot.candidates?.[0]?.content?.parts ?? [];
        const imgPart = parts.find((p: any) => p.inlineData);
        if (!imgPart?.inlineData) return;
        const { mimeType = 'image/png', data = '' } = imgPart.inlineData;
        try {
          const url = saveImageToServer(data, mimeType, proposalId, mapping.sourceId, mapping.altIndex, generationId);
          if (!savedImages[mapping.productId]) savedImages[mapping.productId] = [];
          savedImages[mapping.productId][mapping.altIndex] = url;
        } catch (e) {
          console.error(`Failed to save image for ${mapping.productId} alt ${mapping.altIndex}:`, e);
        }
      });

      // Persist enrichment into proposal JSON
      const proposalFile = path.join(DATA_DIR, `${proposalId}.json`);
      if (fs.existsSync(proposalFile)) {
        const proposalData = JSON.parse(fs.readFileSync(proposalFile, 'utf-8'));
        if (!proposalData.aiEnrichments) proposalData.aiEnrichments = {};

        for (const { productId, sourceId } of state.productMap as any[]) {
          const conceptResult = state.concepts[productId];
          if (!conceptResult) continue;
          const imageUrls: string[] = savedImages[productId] ?? [];
          proposalData.aiEnrichments[sourceId] = {
            ...conceptResult,
            design_alternatives: (conceptResult.design_alternatives ?? []).map((alt: any, i: number) => ({
              ...alt,
              generated_image_url: imageUrls[i] ?? null,
            })),
            enriched_at: new Date().toISOString(),
          };
        }
        proposalData.updatedAt = new Date().toISOString();
        fs.writeFileSync(proposalFile, JSON.stringify(proposalData, null, 2));
      }

      state.overallState = 'COMPLETED';
      state.completedAt = new Date().toISOString();
      unlockProposal(proposalId);
      writeJobState(proposalId, state);
      await sendJobNotification(state);

    } else if (job.state && FAILED_STATES.has(job.state)) {
      state.overallState = 'FAILED';
      state.error = `Phase 2 job ended with state: ${job.state}`;
      unlockProposal(proposalId);
      writeJobState(proposalId, state);
      await sendJobNotification(state);
    }
  }

  return state;
}

// ─── Process all pending jobs (called by worker route) ─────────────────────────

export async function processAllPendingJobs(): Promise<{ processed: number; results: any[] }> {
  const allStates = listAllJobStates();
  const pending = allStates.filter(s => s.overallState === 'PHASE1_RUNNING' || s.overallState === 'PHASE2_RUNNING');

  let processed = 0;
  const results: any[] = [];

  for (const state of pending) {
    try {
      const before = state.overallState;
      const after = await advanceJobState(state);
      processed++;
      results.push({ proposalId: state.proposalId, proposalTitle: state.proposalTitle, from: before, to: after.overallState });
    } catch (e) {
      console.error(`Worker failed for proposal ${state.proposalId}:`, e);
      results.push({ proposalId: state.proposalId, proposalTitle: state.proposalTitle, error: String(e) });
    }
  }

  return { processed, results };
}

export function jobStateSummary(state: any) {
  return {
    proposalId: state.proposalId,
    proposalTitle: state.proposalTitle ?? state.proposalId,
    overallState: state.overallState,
    phase: state.phase,
    error: state.error ?? null,
    productCount: state.productMap?.length ?? 0,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt ?? null,
  };
}

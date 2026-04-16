import { GoogleGenAI, ApiError } from '@google/genai';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Singleton client ─────────────────────────────────────────────────────────

let _ai: GoogleGenAI | null = null;

export function getAI(): GoogleGenAI {
  if (!_ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    _ai = new GoogleGenAI({ apiKey });
  }
  return _ai;
}

// ─── File API helpers ─────────────────────────────────────────────────────────

/**
 * Upload a Buffer to the Gemini File API.
 * Returns the File object (contains .name like "files/abc123" and .uri).
 */
export async function uploadBuffer(buf: Buffer, mimeType: string, displayName: string) {
  const ai = getAI();
  const blob = new Blob([new Uint8Array(buf)], { type: mimeType });
  return ai.files.upload({ file: blob, config: { mimeType, displayName } });
}

/**
 * Download a Gemini File API file by name and return its text content.
 * Uses a temp file because the SDK downloads to disk.
 */
export async function downloadFileContent(fileName: string): Promise<string> {
  const ai = getAI();
  const tmpPath = path.join(os.tmpdir(), `gemini-dl-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await ai.files.download({ file: fileName, downloadPath: tmpPath });
    return fs.readFileSync(tmpPath, 'utf-8');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
  }
}

// ─── Batch API helpers ────────────────────────────────────────────────────────

/**
 * Create a Gemini batch prediction job from a File API JSONL file.
 * @param model  e.g. 'gemini-2.0-flash-001'
 * @param srcFileName  File API name, e.g. 'files/abc123'
 */
export async function createBatchJob(model: string, srcFileName: string, displayName: string) {
  const ai = getAI();
  return ai.batches.create({
    model,
    src: { fileName: srcFileName },
    config: { displayName },
  });
}

/** Poll the status of a batch job by its resource name. */
export async function getBatchJob(name: string) {
  const ai = getAI();
  return ai.batches.get({ name });
}

/** Cancel a running batch job by its resource name. */
export async function cancelBatchJob(name: string) {
  const ai = getAI();
  return ai.batches.cancel({ name });
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { ApiError };

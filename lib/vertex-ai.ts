import { GoogleAuth } from 'google-auth-library';

// ─── Auth ────────────────────────────────────────────────────────────────────

function getCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not configured');
  const json = raw.trimStart().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf-8');
  return JSON.parse(json);
}

async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({
    credentials: getCredentials(),
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const res = await client.getAccessToken();
  if (!res.token) throw new Error('Failed to obtain Google access token');
  return res.token;
}

// ─── GCS ─────────────────────────────────────────────────────────────────────

export async function gcsUpload(bucket: string, objectName: string, body: string, contentType = 'application/x-ndjson'): Promise<string> {
  const token = await getAccessToken();
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body,
  });
  if (!res.ok) throw new Error(`GCS upload failed (${res.status}): ${await res.text()}`);
  return `gs://${bucket}/${objectName}`;
}

export async function gcsUploadBuffer(bucket: string, objectName: string, buffer: Buffer, contentType: string): Promise<string> {
  const token = await getAccessToken();
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType, 'Content-Length': String(buffer.length) },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) throw new Error(`GCS upload failed (${res.status}): ${await res.text()}`);
  return `gs://${bucket}/${objectName}`;
}

export async function gcsDownload(bucket: string, objectName: string): Promise<string> {
  const token = await getAccessToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GCS download failed (${res.status}): ${await res.text()}`);
  return res.text();
}

export async function gcsListObjects(bucket: string, prefix: string): Promise<string[]> {
  const token = await getAccessToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?prefix=${encodeURIComponent(prefix)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GCS list failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return (data.items ?? []).map((item: any) => item.name as string);
}

// ─── Vertex AI Batch Prediction ───────────────────────────────────────────────

export async function createBatchPredictionJob(opts: {
  project: string;
  location: string;
  displayName: string;
  model: string;          // e.g. 'gemini-2.0-flash-001'
  inputGcsUri: string;    // gs://...
  outputGcsPrefix: string; // gs://...
}): Promise<string> {
  const { project, location, displayName, model, inputGcsUri, outputGcsPrefix } = opts;
  const token = await getAccessToken();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/batchPredictionJobs`;
  const body = {
    displayName,
    model: `publishers/google/models/${model}`,
    inputConfig: {
      instancesFormat: 'jsonl',
      gcsSource: { uris: [inputGcsUri] },
    },
    outputConfig: {
      predictionsFormat: 'jsonl',
      gcsDestination: { outputUriPrefix: outputGcsPrefix },
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Batch job creation failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.name as string; // e.g. 'projects/xxx/locations/us-central1/batchPredictionJobs/123'
}

export interface BatchJobInfo {
  state: string; // JOB_STATE_PENDING | JOB_STATE_RUNNING | JOB_STATE_SUCCEEDED | JOB_STATE_FAILED | ...
  outputUriPrefix?: string;
  errorMessage?: string;
}

export async function getBatchJobInfo(jobName: string, location: string): Promise<BatchJobInfo> {
  const token = await getAccessToken();
  const url = `https://${location}-aiplatform.googleapis.com/v1/${jobName}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Get batch job failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return {
    state: data.state as string,
    outputUriPrefix: data.outputConfig?.gcsDestination?.outputUriPrefix,
    errorMessage: data.error?.message,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fetch a remote URL and return base64 + mimeType (for inline batch requests) */
export async function fetchAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const normalised = url.startsWith('//') ? `https:${url}` : url;
  const res = await fetch(normalised, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'image/*',
      Referer: 'https://www.taobao.com/',
    },
  });
  if (!res.ok) throw new Error(`Image fetch failed (${res.status}): ${url}`);
  const buf = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
  return { base64: Buffer.from(buf).toString('base64'), mimeType };
}

/** Parse gs://bucket/path into { bucket, objectName } */
export function parseGcsUri(uri: string): { bucket: string; objectName: string } {
  const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Invalid GCS URI: ${uri}`);
  return { bucket: match[1], objectName: match[2] };
}

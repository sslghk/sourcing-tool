import { NextRequest, NextResponse } from 'next/server';

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Referer': 'https://www.taobao.com/',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  return { base64: Buffer.from(buffer).toString('base64'), mimeType };
}

const TRANSLATE_PROMPT = `Look at this product image carefully. Extract ALL visible text from the image (labels, packaging text, brand names, descriptions, specifications, warnings, instructions, etc. — any language).

Translate all extracted text to English.

Return ONLY valid JSON in this exact format:
{
  "translations": [
    { "original": "<original text>", "english": "<english translation>" }
  ],
  "summary": "<a concise English summary of what the text communicates overall>"
}

If no text is found in the image, return:
{ "translations": [], "summary": "No text found in image" }`;

async function callGeminiWithRetry(imagePart: any, maxRetries = 3): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: TRANSLATE_PROMPT },
                imagePart,
              ],
            }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) {
        const status = response.status;
        if ((status === 429 || status === 503) && attempt < maxRetries) {
          const delayMs = Math.min(20000, 3000 * attempt) + Math.floor(Math.random() * 2000);
          console.warn(`Gemini API ${status} — attempt ${attempt}/${maxRetries}, retrying in ${(delayMs / 1000).toFixed(1)}s...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        const errorBody = await response.text();
        throw new Error(`Gemini API error (${status}): ${errorBody.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('No response from Gemini');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in Gemini response');
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delayMs = Math.min(15000, 2000 * attempt) + Math.floor(Math.random() * 1000);
        console.warn(`Image translation attempt ${attempt}/${maxRetries} failed — retrying in ${(delayMs / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError ?? new Error('Gemini call failed after retries');
}

export async function POST(request: NextRequest) {
  try {
    const { imageUrl } = await request.json();

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
    }

    const normalizedUrl = imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl;

    // Always use base64 inline to avoid Gemini file_uri location/network restrictions
    const { base64, mimeType } = await fetchImageAsBase64(normalizedUrl);
    const imagePart = { inline_data: { mime_type: mimeType, data: base64 } };

    const result = await callGeminiWithRetry(imagePart);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Image translation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to translate image' },
      { status: 500 }
    );
  }
}

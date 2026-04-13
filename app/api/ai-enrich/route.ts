import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { buildEnrichmentPrompt } from '@/lib/ai-enrich-prompts';
import { getAI, ApiError } from '@/lib/gemini-ai';

const DATA_DIR = path.join(process.cwd(), 'data', 'proposals');
const AI_IMAGES_DIR = path.join(process.cwd(), 'public', 'ai-images');

function saveImageToServer(dataUrl: string, proposalId: string, productId: string, index: number, generationId: string): string {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;
  const mimeType = match[1];
  const base64Data = match[2];
  const ext = mimeType.split('/')[1] || 'png';
  const safeProductId = productId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(AI_IMAGES_DIR, proposalId, safeProductId);
  fs.mkdirSync(dir, { recursive: true });
  // Include generationId in filename to bust browser cache on regeneration
  const filename = `concept-${index}-${generationId}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(base64Data, 'base64'));
  return `/ai-images/${proposalId}/${safeProductId}/${filename}`;
}


export async function POST(request: NextRequest) {
  try {
    const { imageUrl, userNotes, proposalId, productId, startIndex = 0, generateCount } = await request.json();

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Image URL is required' },
        { status: 400 }
      );
    }

    // Read max AI images from env (default 4)
    const maxAIImages = Math.max(1, parseInt(process.env.MAX_AI_IMAGES || '4', 10));
    // generateCount lets frontend request fewer images (to preserve selected ones)
    const countToGenerate = (typeof generateCount === 'number' && generateCount > 0)
      ? Math.min(generateCount, maxAIImages)
      : maxAIImages;

    // Build prompt dynamically with correct count and user notes
    const prompt = buildEnrichmentPrompt(countToGenerate, userNotes || 'None provided');

    // Normalise the URL (handle protocol-relative URLs)
    const normalizedUrl = imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl;

    // Call Gemini API to get concept descriptions — pass URL directly, no server-side fetch
    const result = await callGemini(normalizedUrl, prompt);

    // Generate images for all design alternatives in parallel
    console.log(`Generating ${result.design_alternatives.length} images in parallel...`);
    const enrichedAlternatives = await Promise.all(
      result.design_alternatives.map(async (alt: any) => {
        try {
          const generatedUrl = await generateImageWithGemini(alt.generated_image_prompt, normalizedUrl);
          return { ...alt, generated_image_url: generatedUrl };
        } catch (error) {
          console.error(`Failed to generate image for concept "${alt.concept_title}":`, error);
          return alt;
        }
      })
    );

    // If proposalId + productId provided, save images to server and persist to proposal JSON
    const generationId = Date.now().toString(36); // unique ID per generation run for cache busting
    if (proposalId && productId) {
      for (let i = 0; i < enrichedAlternatives.length; i++) {
        const alt: any = enrichedAlternatives[i];
        if (alt.generated_image_url?.startsWith('data:')) {
          try {
            // Use startIndex offset so new images don't overwrite existing saved ones
            enrichedAlternatives[i] = {
              ...alt,
              generated_image_url: saveImageToServer(alt.generated_image_url as string, proposalId, productId, startIndex + i, generationId),
            };
          } catch (err) {
            console.error(`Failed to save image ${i} to server:`, err);
          }
        }
      }

      // Persist AI enrichment into proposal JSON on disk
      const proposalFilePath = path.join(DATA_DIR, `${proposalId}.json`);
      if (fs.existsSync(proposalFilePath)) {
        try {
          const proposalData = JSON.parse(fs.readFileSync(proposalFilePath, 'utf-8'));
          if (!proposalData.aiEnrichments) proposalData.aiEnrichments = {};

          // Preserve existing alternatives at indices 0..startIndex-1 (the ones the user
          // previously selected and chose to keep). This ensures regeneration doesn't wipe
          // out previously-selected images on the next reload.
          const existingAlts: any[] = proposalData.aiEnrichments[productId]?.design_alternatives || [];
          const keptAlts = startIndex > 0 ? existingAlts.slice(0, startIndex) : [];
          const mergedAlternatives = [...keptAlts, ...enrichedAlternatives];

          proposalData.aiEnrichments[productId] = {
            ...result,
            design_alternatives: mergedAlternatives,
            enriched_at: new Date().toISOString(),
          };
          proposalData.updatedAt = new Date().toISOString();
          fs.writeFileSync(proposalFilePath, JSON.stringify(proposalData, null, 2));
          console.log(`Saved AI enrichment for product ${productId} in proposal ${proposalId} (${keptAlts.length} kept + ${enrichedAlternatives.length} new = ${mergedAlternatives.length} total)`);
        } catch (err) {
          console.error('Failed to update proposal JSON with AI enrichment:', err);
        }
      }
    }

    return NextResponse.json({
      ...result,
      design_alternatives: enrichedAlternatives
    });
  } catch (error) {
    console.error('AI enrichment error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error details:', errorMessage);
    return NextResponse.json(
      { error: 'Failed to enrich product with AI', details: errorMessage },
      { status: 500 }
    );
  }
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': 'https://www.taobao.com/',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type')?.split(';')[0] || guessMimeType(url);
  return { base64: Buffer.from(buffer).toString('base64'), mimeType };
}

function guessMimeType(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  const map: Record<string, string> = { png: 'image/png', webp: 'image/webp', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
  return map[ext ?? ''] ?? 'image/jpeg';
}

async function callGemini(imageUrl: string, prompt: string, maxRetries = 4) {
  const ai = getAI();
  let base64Fallback: string | undefined;
  let mimeTypeFallback: string | undefined;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const imagePart = base64Fallback
      ? { inlineData: { mimeType: mimeTypeFallback ?? 'image/jpeg', data: base64Fallback } }
      : { fileData: { mimeType: guessMimeType(imageUrl), fileUri: imageUrl } };

    try {
      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ parts: [imagePart, { text: prompt + '\n\nPlease respond with valid JSON only, no additional text.' }] }],
        config: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 8192 },
      });
      const text = result.text ?? result.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text;
      if (!text) throw new Error('No response from Gemini');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in Gemini response');
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 429 || e.status === 503) {
          const baseDelay = Math.min(30000, 6000 * attempt);
          const jitter = Math.floor(Math.random() * 3000);
          const delayMs = baseDelay + jitter;
          console.warn(`Gemini text call ${e.status === 429 ? 'rate-limited (429)' : 'unavailable (503)'} — attempt ${attempt}/${maxRetries}, retrying in ${(delayMs / 1000).toFixed(1)}s...`);
          lastError = e;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        if (e.status === 400 && e.message.includes('Cannot fetch content') && !base64Fallback) {
          console.warn('Gemini cannot fetch URL, falling back to base64 inline upload...');
          const fetched = await fetchImageAsBase64(imageUrl);
          base64Fallback = fetched.base64;
          mimeTypeFallback = fetched.mimeType;
          continue;
        }
      }
      throw e;
    }
  }

  throw lastError ?? new Error('callGemini failed after retries');
}

async function generateImageWithGemini(prompt: string, imageUrl: string, maxRetries = 4): Promise<string> {
  const ai = getAI();
  console.log(`Generating image with gemini-2.5-flash-image for: ${prompt.substring(0, 80)}...`);

  let base64Fallback: string | undefined;
  let mimeTypeFallback: string | undefined;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const imagePart = base64Fallback
      ? { inlineData: { mimeType: mimeTypeFallback ?? 'image/jpeg', data: base64Fallback } }
      : { fileData: { mimeType: guessMimeType(imageUrl), fileUri: imageUrl } };

    try {
      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ parts: [
          imagePart,
          { text: `You are generating a professional product photo for e-commerce.\n\nTASK: Create a photorealistic product image matching this design brief exactly:\n${prompt}\n\nREQUIREMENTS:\n- The generated product MUST be the same type/category as the reference image shown above\n- Apply ALL the specific design changes described in the brief\n- Pure white background\n- Professional studio lighting, sharp focus\n- No text overlays, no watermarks, no people, no hands\n- Product fills most of the frame` },
        ]}],
        config: { responseModalities: ['IMAGE', 'TEXT'] as any, temperature: 0.8 },
      });

      const parts = result.candidates?.[0]?.content?.parts ?? [];
      console.log('Gemini image response parts summary:', parts.map((p: any) => ({
        hasInlineData: !!p.inlineData, textSnippet: p.text?.substring(0, 80),
        mimeType: p.inlineData?.mimeType, dataLength: p.inlineData?.data?.length,
      })));

      const imgPart = parts.find((p: any) => p.inlineData);
      if (!imgPart?.inlineData) {
        console.error('No image part found. Full candidate:', JSON.stringify(result.candidates?.[0]).substring(0, 500));
        throw new Error('No image returned by Gemini image model');
      }
      const { mimeType = 'image/png', data } = imgPart.inlineData as { mimeType?: string; data: string };
      console.log(`Image generated — mimeType: ${mimeType}, base64 length: ${data?.length}`);
      return `data:${mimeType};base64,${data}`;

    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 429) {
          const isQuotaExhausted = e.message.includes('quota') && e.message.includes('daily');
          if (isQuotaExhausted) throw new Error('Daily Gemini quota exhausted. Try again tomorrow or upgrade your API tier.');
          const baseDelay = Math.min(20000, 5000 * attempt);
          const jitter = Math.floor(Math.random() * 3000);
          const delayMs = baseDelay + jitter;
          console.warn(`Gemini image rate-limited (429) — attempt ${attempt}/${maxRetries}, retrying in ${(delayMs / 1000).toFixed(1)}s...`);
          lastError = e;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        if (e.status === 400 && e.message.includes('Cannot fetch content') && !base64Fallback) {
          console.warn('Gemini image cannot fetch URL, falling back to base64...');
          const fetched = await fetchImageAsBase64(imageUrl);
          base64Fallback = fetched.base64;
          mimeTypeFallback = fetched.mimeType;
          lastError = e;
          continue;
        }
      }
      throw e;
    }
  }

  throw lastError ?? new Error('Gemini image generation failed after retries');
}

async function callClaude(imageUrl: string, prompt: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  // Fetch the image and convert to base64
  const imageResponse = await fetch(imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString('base64');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: prompt + '\n\nPlease respond with valid JSON only, no additional text.',
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.statusText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  
  if (!text) {
    throw new Error('No response from Claude');
  }

  // Extract JSON from response (in case there's markdown formatting)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in Claude response');
  }

  return JSON.parse(jsonMatch[0]);
}

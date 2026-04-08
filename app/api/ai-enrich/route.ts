import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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

function buildEnrichmentPrompt(count: number, userNotes: string): string {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const examples = Array.from({ length: count }, (_, i) => `    {
      "concept_title": "<short distinctive name for Variant ${labels[i] || i + 1}>",
      "generated_image_prompt": "<MUST start with: 'Product photo of [exact product type from original image]:' then describe the specific design changes — color, material, texture, pattern, finish, style. End with: 'White background, professional e-commerce studio lighting, no text, no people, product fills frame.'>",
      "short_description": "<under 20 words>",
      "design_rationale": "<why this variant is commercially compelling>"
    }`).join(',\n');

  return `You are a senior industrial designer for a global product sourcing company. Analyze the product image and generate ${count} DISTINCT design variants.

⚠️ CRITICAL RULES (violations will be rejected):
1. ALL variants MUST be the EXACT SAME product type/category as the original (e.g., if original is a USB cable, ALL variants must be USB cables — not accessories, not cases, not other products)
2. Each variant must look VISUALLY DIFFERENT from the others and from the original
3. The generated_image_prompt must be self-contained and specific enough to recreate the design from text alone — include product type, all key visual features, colors, materials
4. User Notes below MUST be incorporated into the design directions

INPUTS:
- Product Image: (attached)
- User Notes: ${userNotes}

DESIGN DIMENSIONS TO VARY (stay within same product category):
- Color palette / gradient / finish (matte, glossy, metallic, translucent)
- Material texture (braided, silicone, leather-look, frosted)
- Pattern / graphic / motif (geometric, floral, character, minimal)
- Style target (luxury, kids, sporty, eco, retro, futuristic)
- Functional accent (ergonomic grip, extra indicator light, unique connector style)

OUTPUT FORMAT (valid JSON only, no markdown fences):
{
  "original_product": {
    "title": "<short title under 8 words>",
    "description": "<short description under 20 words>",
    "specifications": {
      "dimensions": "<estimated dimensions or N/A>",
      "weight": "<estimated weight or N/A>",
      "materials": "<primary materials or N/A>",
      "other_specs": "<other specs or N/A>"
    }
  },
  "design_alternatives": [
${examples}
  ]
}`;
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

    // Generate images for each design alternative (sequentially to avoid rate limits)
    console.log('Generating images for design alternatives...');
    const enrichedAlternatives = [];
    for (const alt of result.design_alternatives) {
      try {
        const generatedUrl = await generateImageWithGemini(alt.generated_image_prompt, normalizedUrl);
        enrichedAlternatives.push({
          ...alt,
          generated_image_url: generatedUrl
        });
      } catch (error) {
        console.error(`Failed to generate image for concept "${alt.concept_title}":`, error);
        enrichedAlternatives.push(alt);
      }
      // Small delay between image generation requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

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
          proposalData.aiEnrichments[productId] = {
            ...result,
            design_alternatives: enrichedAlternatives,
            enriched_at: new Date().toISOString(),
          };
          proposalData.updatedAt = new Date().toISOString();
          fs.writeFileSync(proposalFilePath, JSON.stringify(proposalData, null, 2));
          console.log(`Saved AI enrichment for product ${productId} in proposal ${proposalId}`);
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

function buildImagePart(imageUrl: string, base64?: string, mimeType?: string) {
  if (base64) {
    return { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } };
  }
  return { file_data: { mime_type: guessMimeType(imageUrl), file_uri: imageUrl } };
}

async function callGemini(imageUrl: string, prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  let base64Fallback: string | undefined;
  let mimeTypeFallback: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const imagePart = buildImagePart(imageUrl, base64Fallback, mimeTypeFallback);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt + '\n\nPlease respond with valid JSON only, no additional text.' },
              imagePart,
            ],
          }],
          generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 8192 },
        }),
      }
    );

    if (response.ok) {
      const data = await response.json();
      console.log('Gemini API response:', JSON.stringify(data, null, 2));
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('No response from Gemini');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in Gemini response');
      return JSON.parse(jsonMatch[0]);
    }

    const errorBody = await response.text();
    const canFallback = response.status === 400 && errorBody.includes('Cannot fetch content');
    if (canFallback && attempt === 1) {
      console.warn('Gemini cannot fetch URL, falling back to base64 inline upload...');
      const fetched = await fetchImageAsBase64(imageUrl);
      base64Fallback = fetched.base64;
      mimeTypeFallback = fetched.mimeType;
      continue;
    }

    console.error('Gemini API error response:', errorBody);
    throw new Error(`Gemini API error (${response.status}): ${response.statusText} - ${errorBody}`);
  }

  throw new Error('callGemini failed after fallback');
}

async function generateImageWithGemini(prompt: string, imageUrl: string, maxRetries = 4): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  console.log(`Generating image with gemini-2.5-flash-image for: ${prompt.substring(0, 80)}...`);

  let base64Fallback: string | undefined;
  let mimeTypeFallback: string | undefined;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const imagePart = buildImagePart(imageUrl, base64Fallback, mimeTypeFallback);
    const body = JSON.stringify({
      contents: [{
        parts: [
          imagePart,
          { text: `You are generating a professional product photo for e-commerce.\n\nTASK: Create a photorealistic product image matching this design brief exactly:\n${prompt}\n\nREQUIREMENTS:\n- The generated product MUST be the same type/category as the reference image shown above\n- Apply ALL the specific design changes described in the brief\n- Pure white background\n- Professional studio lighting, sharp focus\n- No text overlays, no watermarks, no people, no hands\n- Product fills most of the frame` }
        ]
      }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.8 },
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
    );

    if (response.ok) {
      // Success — fall through to parsing
      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts ?? [];

      console.log('Gemini image response parts summary:', parts.map((p: any) => ({
        keys: Object.keys(p),
        hasInlineData: !!(p.inlineData ?? p.inline_data),
        textSnippet: p.text ? p.text.substring(0, 80) : undefined,
        mimeType: (p.inlineData ?? p.inline_data)?.mimeType ?? (p.inlineData ?? p.inline_data)?.mime_type,
        dataLength: (p.inlineData ?? p.inline_data)?.data?.length,
      })));

      const imagePart = parts.find((p: any) => p.inlineData ?? p.inline_data);

      if (!imagePart) {
        console.error('No image part found. Full candidate:', JSON.stringify(data.candidates?.[0], null, 2).substring(0, 500));
        throw new Error('No image returned by Gemini 2.5 Flash');
      }

      const inlineData = imagePart.inlineData ?? imagePart.inline_data;
      const mimeType = inlineData.mimeType ?? inlineData.mime_type ?? 'image/png';
      console.log(`Image generated successfully — mimeType: ${mimeType}, base64 length: ${inlineData.data?.length}`);
      return `data:${mimeType};base64,${inlineData.data}`;
    }

    const errorBody = await response.text();

    if (response.status === 429) {
      const delayMs = Math.min(15000, 5000 * attempt); // 5s, 10s, 15s, 15s
      console.warn(`Gemini image generation rate-limited (429) — attempt ${attempt}/${maxRetries}, retrying in ${delayMs / 1000}s...`);
      lastError = new Error(`Gemini image generation error (429): ${errorBody}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    if (response.status === 400 && errorBody.includes('Cannot fetch content') && !base64Fallback) {
      console.warn('Gemini image generation cannot fetch URL, falling back to base64 inline upload...');
      const fetched = await fetchImageAsBase64(imageUrl);
      base64Fallback = fetched.base64;
      mimeTypeFallback = fetched.mimeType;
      lastError = new Error(`Gemini image generation error (400): ${errorBody}`);
      continue;
    }

    // Non-retryable error
    console.error('Gemini image generation error:', errorBody);
    throw new Error(`Gemini image generation error (${response.status}): ${errorBody}`);
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

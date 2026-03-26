import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'proposals');
const AI_IMAGES_DIR = path.join(process.cwd(), 'public', 'ai-images');

function saveImageToServer(dataUrl: string, proposalId: string, productId: string, index: number): string {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;
  const mimeType = match[1];
  const base64Data = match[2];
  const ext = mimeType.split('/')[1] || 'png';
  const safeProductId = productId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(AI_IMAGES_DIR, proposalId, safeProductId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `concept-${index}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(base64Data, 'base64'));
  return `/ai-images/${proposalId}/${safeProductId}/${filename}`;
}

const AI_ENRICHMENT_PROMPT = `You are a senior industrial designer working for a global product sourcing company. Your task is to analyze the uploaded product image and propose alternative design concepts that could be manufactured and sold as product variations.

INPUTS  
- Product Image: (attached automatically)  
- User Notes (optional): {{user_notes}}

OBJECTIVES  
1. Identify what the original product is.  
2. Generate a concise title and description for the original product.  
3. Extract key product specifications (dimensions, weight, materials) from the image.
4. Create multiple alternative product design concepts inspired by the original item.

Alternative concepts should be:
- manufacturable at scale
- visually differentiated
- commercially appealing for e-commerce
- simple enough for factories to produce

You may modify:
- shape
- theme or character
- materials
- colors
- emotional tone
- function or usability
- gifting appeal

OUTPUT FORMAT (JSON)

{
  "original_product": {
    "title": "<short title under 8 words>",
    "description": "<short description under 20 words>",
    "specifications": {
      "dimensions": "<estimated dimensions in cm or inches, e.g., '15 x 10 x 8 cm' or 'N/A if not visible'>",
      "weight": "<estimated weight in grams or kg, e.g., '200g' or 'N/A if not determinable'>",
      "materials": "<primary materials used, e.g., 'Polyester plush, PP cotton filling' or 'N/A if not visible'>",
      "other_specs": "<any other notable specifications like capacity, power, etc. or 'N/A'>"
    }
  },
  "design_alternatives": [
    {
      "concept_title": "<short name>",
      "generated_image_prompt": "<detailed visual description for generating the alternative product image - be specific about colors, materials, style, and key features>",
      "short_description": "<under 20 words>",
      "design_rationale": "<why this design is compelling or commercially interesting>"
    },
    {
      "concept_title": "<short name>",
      "generated_image_prompt": "<detailed visual description for generating the alternative product image - be specific about colors, materials, style, and key features>",
      "short_description": "<under 20 words>",
      "design_rationale": "<why this design is compelling or commercially interesting>"
    },
    {
      "concept_title": "<short name>",
      "generated_image_prompt": "<detailed visual description for generating the alternative product image - be specific about colors, materials, style, and key features>",
      "short_description": "<under 20 words>",
      "design_rationale": "<why this design is compelling or commercially interesting>"
    }
  ]
}

GUIDELINES

- Generate exactly 3 alternative concepts.
- Keep designs practical for manufacturing.
- Avoid unrealistic materials or extremely complex structures.
- Alternative concepts should be meaningfully different from the original product.
- Favor ideas that could perform well as gift items or viral e-commerce products.`;

export async function POST(request: NextRequest) {
  try {
    const { imageUrl, userNotes, proposalId, productId } = await request.json();

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Image URL is required' },
        { status: 400 }
      );
    }

    // Prepare the prompt with user notes if provided
    const prompt = AI_ENRICHMENT_PROMPT.replace('{{user_notes}}', userNotes || 'None provided');

    // Fetch original image once and reuse for all calls
    const normalizedUrl = imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl;
    const imageResponse = await fetch(normalizedUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const originalImageBase64 = Buffer.from(imageBuffer).toString('base64');

    // Call Gemini API to get concept descriptions (with original image)
    const result = await callGemini(originalImageBase64, prompt);

    // Generate images for each design alternative (sequentially to avoid rate limits)
    console.log('Generating images for design alternatives...');
    const enrichedAlternatives = [];
    for (const alt of result.design_alternatives) {
      try {
        const generatedUrl = await generateImageWithGemini(alt.generated_image_prompt, originalImageBase64);
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
    if (proposalId && productId) {
      for (let i = 0; i < enrichedAlternatives.length; i++) {
        const alt: any = enrichedAlternatives[i];
        if (alt.generated_image_url?.startsWith('data:')) {
          try {
            enrichedAlternatives[i] = {
              ...alt,
              generated_image_url: saveImageToServer(alt.generated_image_url as string, proposalId, productId, i),
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

async function callGemini(base64Image: string, prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt + '\n\nPlease respond with valid JSON only, no additional text.',
              },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: base64Image,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Gemini API error response:', errorBody);
    throw new Error(`Gemini API error (${response.status}): ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json();
  console.log('Gemini API response:', JSON.stringify(data, null, 2));
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!text) {
    throw new Error('No response from Gemini');
  }

  // Extract JSON from response (in case there's markdown formatting)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in Gemini response');
  }

  return JSON.parse(jsonMatch[0]);
}

async function generateImageWithGemini(prompt: string, originalImageBase64: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  console.log(`Generating image with gemini-2.5-flash-image for: ${prompt.substring(0, 80)}...`);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: originalImageBase64,
              }
            },
            {
              text: `Generate a product photo variation: ${prompt}. Clean white background, professional e-commerce style, studio lighting.`
            }
          ]
        }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          temperature: 0.8,
        }
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Gemini image generation error:', errorBody);
    throw new Error(`Gemini image generation error (${response.status}): ${errorBody}`);
  }

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

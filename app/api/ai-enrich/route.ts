import { NextRequest, NextResponse } from 'next/server';

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
    const { imageUrl, userNotes } = await request.json();

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Image URL is required' },
        { status: 400 }
      );
    }

    // Prepare the prompt with user notes if provided
    const prompt = AI_ENRICHMENT_PROMPT.replace('{{user_notes}}', userNotes || 'None provided');

    // Call Gemini API to get concept descriptions
    const result = await callGemini(imageUrl, prompt);

    // Generate images for each design alternative
    console.log('Generating images for design alternatives...');
    const enrichedAlternatives = await Promise.all(
      result.design_alternatives.map(async (alt: any) => {
        try {
          const imageUrl = await generateImageWithImagen(alt.generated_image_prompt);
          return {
            ...alt,
            generated_image_url: imageUrl
          };
        } catch (error) {
          console.error(`Failed to generate image for concept "${alt.concept_title}":`, error);
          // Return concept without image if generation fails
          return alt;
        }
      })
    );

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

async function callGemini(imageUrl: string, prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  // Fetch the image and convert to base64
  const imageResponse = await fetch(imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString('base64');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
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
          maxOutputTokens: 2048,
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

async function generateImageWithImagen(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log(`Generating image with Gemini for prompt: ${prompt.substring(0, 100)}...`);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Gemini image generation error response:', errorBody);
    throw new Error(`Gemini image generation error (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();
  console.log('Gemini image generation response received');
  
  // Extract image from response parts
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error('No parts in Gemini response');
  }

  // Find the part with inline_data (the generated image)
  const imagePart = parts.find((part: any) => part.inline_data || part.inlineData);
  if (!imagePart) {
    throw new Error('No image generated by Gemini');
  }

  // Get base64 image data (handle both inline_data and inlineData formats)
  const imageBase64 = imagePart.inline_data?.data || imagePart.inlineData?.data;
  if (!imageBase64) {
    throw new Error('No image data in Gemini response');
  }

  // Return as data URL for direct display
  return `data:image/png;base64,${imageBase64}`;
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

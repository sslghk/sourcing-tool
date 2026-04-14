import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SearchRequest, SearchResponse, Platform } from '@/types/product';

function needsTranslation(text: string): boolean {
  if (!text || typeof text !== 'string' || text.trim() === '') return false;
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

async function translateTextsWithGemini(texts: string[], maxRetries = 3): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || texts.length === 0) return texts;

  const indicesToTranslate: number[] = [];
  const textsToSend: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (needsTranslation(texts[i])) {
      indicesToTranslate.push(i);
      textsToSend.push(texts[i]);
    }
  }
  if (textsToSend.length === 0) return texts;

  const prompt = `Translate the following texts from Chinese to English. Return ONLY a JSON array of translated strings in the same order. Preserve numbers, brand names, URLs, units, and technical terms exactly as-is.\n\n${JSON.stringify(textsToSend)}`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
          }),
          signal: AbortSignal.timeout(60000),
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
        throw new Error(`Gemini API error: ${status}`);
      }
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array in Gemini response');
      const translated: string[] = JSON.parse(jsonMatch[0]);
      const resultTexts = [...texts];
      for (let i = 0; i < indicesToTranslate.length; i++) {
        if (translated[i] !== undefined) resultTexts[indicesToTranslate[i]] = String(translated[i]);
      }
      console.log(`Translated ${textsToSend.length} product text fields`);
      return resultTexts;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delayMs = Math.min(15000, 2000 * attempt) + Math.floor(Math.random() * 1000);
        console.warn(`Translation attempt ${attempt}/${maxRetries} failed — retrying in ${(delayMs / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  console.error('Search translation failed after retries, returning originals:', lastError);
  return texts;
}

async function translateProducts(products: any[]): Promise<any[]> {
  const texts: string[] = [];
  const map: Array<{ idx: number; field: 'title' | 'description_short' }> = [];
  products.forEach((p, i) => {
    texts.push(p.title || '');
    map.push({ idx: i, field: 'title' });
    texts.push(p.description_short || '');
    map.push({ idx: i, field: 'description_short' });
  });
  if (texts.every(t => !needsTranslation(t))) return products;
  const translated = await translateTextsWithGemini(texts);
  const result = products.map(p => ({ ...p }));
  map.forEach(({ idx, field }, i) => {
    if (translated[i]) result[idx][field] = translated[i];
  });
  return result;
}

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  platforms: z.array(z.enum(['taobao', '1688', 'temu', 'amazon'])),
  filters: z.object({
    price_min: z.number().optional(),
    price_max: z.number().optional(),
    category: z.string().optional(),
    moq_max: z.number().optional(),
  }).optional(),
  page: z.number().default(1),
  limit: z.number().default(parseInt(process.env.NEXT_PUBLIC_SEARCH_RESULT_LIMIT || '50', 10)),
});

const SERVICE_URLS: Record<Platform, string> = {
  taobao: process.env.TAOBAO_SERVICE_URL || 'http://localhost:8000',
  '1688': 'http://localhost:8002', // Not implemented yet
  temu: 'http://localhost:8003', // Not implemented yet
  amazon: 'http://localhost:8004', // Not implemented yet
};

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const validated = searchSchema.parse(body);
    
    const promises = validated.platforms.map(async (platform) => {
      try {
        const response = await fetch(`${SERVICE_URLS[platform]}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: validated.query,
            page: validated.page,
            limit: validated.limit,
            ...validated.filters,
          }),
          signal: AbortSignal.timeout(60000), // 60 seconds for web scraping
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.detail || `${platform} service returned ${response.status}`;
          
          // Check for authentication errors (403)
          if (response.status === 403 || errorMessage.includes('authentication failed') || errorMessage.includes('Forbidden')) {
            throw new Error(`OneBound API authentication failed. Please check your API key and secret in the .env file.`);
          }
          
          // Check for quota exceeded error
          if (errorMessage.includes('已超量') || errorMessage.includes('quota') || errorMessage.includes('exceeded')) {
            throw new Error(`API quota exceeded. Please check your OneBound API key or upgrade your plan.`);
          }
          
          throw new Error(errorMessage);
        }
        
        const data = await response.json();
        return { platform, products: data.products || [], error: null };
      } catch (error) {
        console.error(`Error fetching from ${platform}:`, error);
        return { 
          platform, 
          products: [], 
          error: error instanceof Error ? error.message : 'Unknown error' 
        };
      }
    });
    
    const results = await Promise.all(promises);
    
    const rawProducts = results.flatMap(r => r.products);
    const allProducts = await translateProducts(rawProducts);
    const errors = results
      .filter(r => r.error)
      .reduce((acc, r) => ({ ...acc, [r.platform]: r.error }), {});
    
    const response: SearchResponse = {
      products: allProducts,
      pagination: {
        total: allProducts.length,
        page: validated.page,
        limit: validated.limit,
        hasMore: false,
      },
      metadata: {
        searchTime: Date.now() - startTime,
        platformsQueried: validated.platforms,
        platformErrors: Object.keys(errors).length > 0 ? errors : undefined,
      },
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Search error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.issues },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SearchRequest, SearchResponse, Platform } from '@/types/product';

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
  limit: z.number().default(20),
});

const SERVICE_URLS: Record<Platform, string> = {
  taobao: process.env.TAOBAO_SERVICE_URL || 'http://localhost:8001',
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
    
    const allProducts = results.flatMap(r => r.products);
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

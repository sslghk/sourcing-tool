import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image') as File;
    
    if (!image) {
      return NextResponse.json(
        { error: 'No image provided' },
        { status: 400 }
      );
    }

    // Forward the image directly to the Taobao service
    const taobaoServiceUrl = process.env.TAOBAO_SERVICE_URL || 'http://localhost:8000';
    
    // Create new FormData to send to Taobao service
    const taobaoFormData = new FormData();
    taobaoFormData.append('image', image);
    
    const searchResponse = await fetch(`${taobaoServiceUrl}/search-image`, {
      method: 'POST',
      body: taobaoFormData,
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error(`Taobao service returned ${searchResponse.status}: ${errorText}`);
      throw new Error(`Taobao service returned ${searchResponse.status}`);
    }

    const data = await searchResponse.json();
    
    return NextResponse.json({
      products: data.products || [],
      total: data.total || 0,
    });

  } catch (error) {
    console.error('Error in image search:', error);
    return NextResponse.json(
      { error: 'Failed to search by image', details: String(error) },
      { status: 500 }
    );
  }
}

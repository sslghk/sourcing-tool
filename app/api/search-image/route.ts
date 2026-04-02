import { NextRequest, NextResponse } from 'next/server';

const TAOBAO_SERVICE_URL = process.env.TAOBAO_SERVICE_URL || 'http://localhost:8001';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image');

    if (!image || !(image instanceof Blob)) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Forward the multipart form to the Python service
    const forwardForm = new FormData();
    forwardForm.append('image', image, (image as File).name || 'image.jpg');

    const response = await fetch(`${TAOBAO_SERVICE_URL}/search-image`, {
      method: 'POST',
      body: forwardForm,
      signal: AbortSignal.timeout(120000), // 2 min timeout for image upload + search
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = errorData.detail || errorData.error || `Service returned ${response.status}`;
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Image search error:', error);
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Image search timed out. Please try again.' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

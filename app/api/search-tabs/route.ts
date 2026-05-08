import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { auth } from '@/auth.config';

const DATA_DIR = path.join(process.cwd(), 'data', 'search-tabs');

function getFilePath(email: string): string {
  const safeEmail = email.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(DATA_DIR, `${safeEmail}.json`);
}

// GET /api/search-tabs - Load saved tabs for the current user
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const filePath = getFilePath(session.user.email);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ tabs: [], activeTabId: null });
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('Error loading search tabs:', e);
    return NextResponse.json({ tabs: [], activeTabId: null });
  }
}

// PUT /api/search-tabs - Save tabs for the current user
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tabs, activeTabId } = await request.json();

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const filePath = getFilePath(session.user.email);
    fs.writeFileSync(filePath, JSON.stringify({ tabs, activeTabId, updatedAt: new Date().toISOString() }, null, 2));

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Error saving search tabs:', e);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

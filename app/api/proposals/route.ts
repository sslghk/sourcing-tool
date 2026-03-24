import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { auth } from '@/auth.config';

const DATA_DIR = path.join(process.cwd(), 'data', 'proposals');

// GET /api/proposals - List all proposals from JSON files
export async function GET(request: NextRequest) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      return NextResponse.json({ proposals: [] });
    }

    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const proposals = [];

    for (const file of files) {
      try {
        const filePath = path.join(DATA_DIR, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);

        // Return summary info (not full itemDetails to keep response small)
        proposals.push({
          id: data.proposalId,
          name: data.proposalName || 'Untitled',
          client_name: data.clientName || '',
          notes: data.notes || '',
          status: data.status || 'draft',
          created_at: data.createdAt,
          updated_at: data.updatedAt,
          createdBy: data.createdBy || null,
          totalItems: data.totalItems || data.products?.length || 0,
          successfulItems: data.successfulItems || 0,
          totalValue: data.products?.reduce((sum: number, p: any) => sum + (p.price?.current || 0), 0) || 0,
          currency: 'CNY',
          products: data.products || [],
        });
      } catch (e) {
        console.error(`Error reading proposal file ${file}:`, e);
      }
    }

    // Sort by created_at descending (newest first)
    proposals.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json({ proposals });
  } catch (error) {
    console.error('Error listing proposals:', error);
    return NextResponse.json(
      { error: 'Failed to list proposals' },
      { status: 500 }
    );
  }
}

// DELETE /api/proposals?id=xxx - Delete a proposal JSON file
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const proposalId = searchParams.get('id');

    if (!proposalId) {
      return NextResponse.json(
        { error: 'Proposal ID is required' },
        { status: 400 }
      );
    }

    const filePath = path.join(DATA_DIR, `${proposalId}.json`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'Proposal file not found' },
        { status: 404 }
      );
    }

    fs.unlinkSync(filePath);
    console.log(`Deleted proposal file: ${filePath}`);

    return NextResponse.json({ success: true, deletedId: proposalId });
  } catch (error) {
    console.error('Error deleting proposal:', error);
    return NextResponse.json(
      { error: 'Failed to delete proposal' },
      { status: 500 }
    );
  }
}

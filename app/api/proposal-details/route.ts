import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  getProposalFilePath,
  fetchProductDetailsWithRetry,
  translateProductDetails,
  fetchAndSaveItemDetails,
} from '@/lib/proposal-helpers';

const DATA_DIR = path.join(process.cwd(), 'data', 'proposals');

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// POST /api/proposal-details - Create proposal and fetch all item details
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { products, proposalName, clientName, notes, proposalId: clientProposalId, createdBy, skipDetailsFetch } = body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { error: 'products array is required and must not be empty' },
        { status: 400 }
      );
    }

    const proposalId = clientProposalId || randomUUID();
    ensureDataDir();

    // Deduplicate incoming products by source_id before saving
    const seenIds = new Set<string>();
    const uniqueProducts = products.filter((p: any) => {
      if (seenIds.has(p.source_id)) return false;
      seenIds.add(p.source_id);
      return true;
    });

    const filePath = getProposalFilePath(proposalId);
    const data: any = {
      proposalId,
      proposalName: proposalName || `Proposal ${new Date().toLocaleDateString()}`,
      clientName: clientName || '',
      notes: notes || '',
      createdBy: createdBy || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      products: uniqueProducts.map((p: any) => ({
        id: p.id, source_id: p.source_id, source: p.source,
        title: p.title, price: p.price, image_urls: p.image_urls,
        url: p.url, moq: p.moq, seller: p.seller,
      })),
      itemDetails: {},
      totalItems: uniqueProducts.length,
      successfulItems: 0,
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Created proposal file: ${filePath}`);

    if (skipDetailsFetch) {
      return NextResponse.json({
        success: true, proposalId,
        totalItems: uniqueProducts.length, successfulItems: 0,
        message: `Proposal structure saved. Details will be fetched per-product.`,
      });
    }

    const successfulCount = await fetchAndSaveItemDetails(data, uniqueProducts, filePath);
    console.log(`POST complete: ${successfulCount}/${uniqueProducts.length} details fetched`);

    return NextResponse.json({
      success: true, proposalId,
      totalItems: products.length, successfulItems: successfulCount,
      message: `Proposal saved with ${successfulCount}/${products.length} item details fetched.`,
    });

  } catch (error) {
    console.error('Error in POST /api/proposal-details:', error);
    return NextResponse.json(
      { error: 'Failed to save proposal details', details: String(error) },
      { status: 500 }
    );
  }
}

// GET /api/proposal-details?proposalId=xxx&productId=yyy&fetch=true - Get proposal/product details
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const proposalId = searchParams.get('proposalId');
    const productId = searchParams.get('productId');
    const shouldFetch = searchParams.get('fetch') === 'true';
    const shouldRefresh = searchParams.get('refresh') === 'true';
    
    if (!proposalId) {
      return NextResponse.json(
        { error: 'proposalId is required' },
        { status: 400 }
      );
    }
    
    const filePath = getProposalFilePath(proposalId);
    
    // If file doesn't exist, return 404
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'Proposal details not found' },
        { status: 404 }
      );
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    // If specific product requested
    if (productId) {
      const numIid = productId; // productId is now the num_iid (source_id)
      
      // Return cached details if available (unless refresh=true forces a re-fetch)
      if (data.itemDetails[numIid] && !shouldRefresh) {
        return NextResponse.json({
          ...data.itemDetails[numIid],
          cached: true
        });
      }

      // If refresh=true, clear existing cache entry so we fetch fresh data
      if (shouldRefresh && data.itemDetails[numIid]) {
        delete data.itemDetails[numIid];
      }

      // If shouldFetch=true (or refresh=true), fetch from API and cache
      if (shouldFetch || shouldRefresh) {
        const product = data.products?.find((p: any) => p.source_id === productId || p.id === productId);
        if (!product) {
          return NextResponse.json(
            { error: 'Product not found in proposal' },
            { status: 404 }
          );
        }
        
        const details = await fetchProductDetailsWithRetry(productId, product.source || 'taobao', 3);
        
        if (details) {
          // Translate text fields before caching
          const translatedDetails = await translateProductDetails(details);
          
          // Cache the details using num_iid as key
          data.itemDetails[numIid] = {
            ...translatedDetails,
            productId: numIid,
            platform: product.source || 'taobao',
            fetchedAt: new Date().toISOString(),
            selectedSecondaryImages: []
          };
          
          data.successfulItems = Object.keys(data.itemDetails).length;
          data.updatedAt = new Date().toISOString();
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
          
          return NextResponse.json({
            ...data.itemDetails[numIid],
            cached: false
          });
        } else {
          return NextResponse.json(
            { error: 'Failed to fetch product details from API after retries' },
            { status: 502 }
          );
        }
      }
      
      return NextResponse.json(
        { error: 'Product details not found in cache' },
        { status: 404 }
      );
    }
    
    // Return all proposal details
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Error in GET /api/proposal-details:', error);
    return NextResponse.json(
      { error: 'Failed to load proposal details', details: String(error) },
      { status: 500 }
    );
  }
}

// PATCH /api/proposal-details - Append new products to existing proposal and fetch their details
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { proposalId, newProducts, skipDetailsFetch } = body;

    if (!proposalId) {
      return NextResponse.json({ error: 'proposalId is required' }, { status: 400 });
    }
    if (!Array.isArray(newProducts) || newProducts.length === 0) {
      return NextResponse.json({ error: 'newProducts array is required' }, { status: 400 });
    }

    ensureDataDir();
    const filePath = getProposalFilePath(proposalId);

    // Read or bootstrap the proposal JSON
    let data: any;
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } else {
      data = {
        proposalId,
        proposalName: body.proposalName || '',
        clientName: body.clientName || '',
        notes: body.notes || '',
        status: body.status || 'draft',
        products: [], itemDetails: {}, aiEnrichments: {},
        totalItems: 0, successfulItems: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    if (!data.itemDetails) data.itemDetails = {};
    if (!data.products) data.products = [];

    // Append only products not already present (deduplicate by source_id)
    const existingIds = new Set(data.products.map((p: any) => p.source_id));
    const toAdd = newProducts.filter((p: any) => !existingIds.has(p.source_id));

    if (toAdd.length === 0) {
      return NextResponse.json({ success: true, added: 0, message: 'No new products (all duplicates)' });
    }

    data.products = [
      ...data.products,
      ...toAdd.map((p: any) => ({
        id: p.id, source_id: p.source_id, source: p.source,
        title: p.title, price: p.price, image_urls: p.image_urls,
        url: p.url, moq: p.moq, seller: p.seller,
      })),
    ];
    // Deduplicate the merged array by source_id to ensure no double-counting
    const seen = new Set<string>();
    data.products = data.products.filter((p: any) => {
      const key = p.source_id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    data.totalItems = data.products.length;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Appended ${toAdd.length} product(s) to proposal ${proposalId} (total: ${data.totalItems})`);

    if (!skipDetailsFetch) {
      // Fetch item details in the background — don't block the response
      fetchAndSaveItemDetails(data, toAdd, filePath)
        .then(count => console.log(`PATCH background: ${count}/${toAdd.length} details fetched for ${proposalId}`))
        .catch(err => console.error(`PATCH background fetch error for ${proposalId}:`, err));
    }

    return NextResponse.json({
      success: true,
      added: toAdd.length,
      addedProducts: toAdd,
      totalItems: data.totalItems,
      message: skipDetailsFetch
        ? `${toAdd.length} product(s) added. Details will be fetched per-product.`
        : `${toAdd.length} product(s) added. Details are being fetched in the background.`,
    });

  } catch (error) {
    console.error('Error in PATCH /api/proposal-details:', error);
    return NextResponse.json(
      { error: 'Failed to append products', details: String(error) },
      { status: 500 }
    );
  }
}

// PUT /api/proposal-details - Update proposal details (image selections, metadata)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      proposalId,
      // Single-product secondary image save (legacy per-click save)
      productId,
      selectedSecondaryImages,
      // Batch save: all AI image selections at once { [sourceId]: string[] }
      allSelectedAIImages,
      // Image translations: { [productId]: { translations: [...], summary: string } }
      imageTranslations,
      // Proposal metadata
      proposalName,
      clientName,
      notes,
      status,
    } = body;

    if (!proposalId) {
      return NextResponse.json({ error: 'proposalId is required' }, { status: 400 });
    }

    const filePath = getProposalFilePath(proposalId);
    const { updatedProducts } = body;

    // Reject user-initiated edits while a batch job is running
    if (fs.existsSync(filePath)) {
      const current = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (current.locked) {
        return NextResponse.json(
          { error: 'This proposal is locked while a batch AI job is in progress. Please wait for the job to complete.' },
          { status: 423 }
        );
      }
    }

    if (!fs.existsSync(filePath)) {
      // Bootstrap a minimal file if we're given a product list (e.g. adding to older proposal)
      if (Array.isArray(updatedProducts)) {
        ensureDataDir();
        const bootstrap = {
          proposalId,
          proposalName: body.proposalName || '',
          clientName: body.clientName || '',
          notes: body.notes || '',
          status: body.status || 'draft',
          products: updatedProducts,
          totalItems: updatedProducts.length,
          itemDetails: {},
          aiEnrichments: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(filePath, JSON.stringify(bootstrap, null, 2));
        console.log(`Bootstrapped proposal JSON for ${proposalId} with ${updatedProducts.length} products`);
        return NextResponse.json({ success: true, bootstrapped: true });
      }
      return NextResponse.json({ error: 'Proposal details not found' }, { status: 404 });
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    data.updatedAt = new Date().toISOString();

    // ── Single-product secondary image selection (per-click auto-save) ──
    if (productId && selectedSecondaryImages !== undefined) {
      const numIid = productId;
      if (data.itemDetails && data.itemDetails[numIid]) {
        data.itemDetails[numIid].selectedSecondaryImages = selectedSecondaryImages;
        console.log(`Updated secondary image selection for ${numIid}`);
      }
    }

    // ── Batch AI image selections save ───────────────────────────────────
    if (allSelectedAIImages && typeof allSelectedAIImages === 'object') {
      if (!data.itemDetails) data.itemDetails = {};
      for (const [sourceId, images] of Object.entries(allSelectedAIImages)) {
        if (!data.itemDetails[sourceId]) data.itemDetails[sourceId] = {};
        (data.itemDetails[sourceId] as any).selectedAIImages = images;
      }
      console.log(`Saved AI image selections for ${Object.keys(allSelectedAIImages).length} products`);
    }

    // ── Product list update (e.g. after deletion / adding items) ─────────
    if (Array.isArray(updatedProducts)) {
      data.products = updatedProducts;
      data.totalItems = updatedProducts.length;
      console.log(`Updated product list: ${updatedProducts.length} items`);
    }

    // ── Image translations (per product, keyed by source_id) ────────────
    if (imageTranslations && typeof imageTranslations === 'object') {
      if (!data.imageTranslations) data.imageTranslations = {};
      Object.assign(data.imageTranslations, imageTranslations);
      console.log(`Saved image translations for ${Object.keys(imageTranslations).length} products`);
    }

    // ── Proposal metadata ─────────────────────────────────────────────────
    if (proposalName !== undefined) data.proposalName = proposalName;
    if (clientName !== undefined) data.clientName = clientName;
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) data.status = status;

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error in PUT /api/proposal-details:', error);
    return NextResponse.json(
      { error: 'Failed to update proposal details', details: String(error) },
      { status: 500 }
    );
  }
}

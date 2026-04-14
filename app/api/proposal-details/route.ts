import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import translate from 'google-translate-api-x';

const DATA_DIR = path.join(process.cwd(), 'data', 'proposals');

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Get file path for proposal details
function getProposalFilePath(proposalId: string) {
  return path.join(DATA_DIR, `${proposalId}.json`);
}

// Returns true if text contains Chinese characters and needs translation
function needsTranslation(text: string): boolean {
  if (!text || typeof text !== 'string' || text.trim() === '') return false;
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

// Translate a batch of texts using Gemini (reliable on server IPs unlike web-scraped Google Translate)
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
            generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
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
      console.log(`Gemini translated ${textsToSend.length} text fields`);
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

  console.error('Gemini translation failed after retries, falling back to google-translate-api-x:', lastError);
  // Fallback: google-translate-api-x
  try {
    const result = [...texts];
    for (let i = 0; i < indicesToTranslate.length; i++) {
      const idx = indicesToTranslate[i];
      try {
        const r = await translate(texts[idx], { from: 'zh-CN', to: 'en' });
        result[idx] = r.text || texts[idx];
      } catch { /* keep original */ }
    }
    return result;
  } catch {
    return texts;
  }
}

// Translate all text fields in product details from Chinese to English
async function translateProductDetails(details: any): Promise<any> {
  if (!details) return details;
  
  const translated = { ...details };
  
  // Collect all translatable text fields
  const textsToTranslate: string[] = [];
  const fieldMap: { field: string; index: number; subField?: string; subIndex?: number }[] = [];
  
  // Simple text fields
  const textFields = ['title', 'desc_short', 'description', 'brand', 'category'];
  for (const field of textFields) {
    if (details[field] && typeof details[field] === 'string') {
      textsToTranslate.push(details[field]);
      fieldMap.push({ field, index: textsToTranslate.length - 1 });
    }
  }
  
  // Seller fields
  if (details.seller) {
    if (details.seller.name && typeof details.seller.name === 'string') {
      textsToTranslate.push(details.seller.name);
      fieldMap.push({ field: 'seller', subField: 'name', index: textsToTranslate.length - 1 });
    }
    if (details.seller.location && typeof details.seller.location === 'string') {
      textsToTranslate.push(details.seller.location);
      fieldMap.push({ field: 'seller', subField: 'location', index: textsToTranslate.length - 1 });
    }
  }
  
  // Props array - {name, value} pairs
  if (Array.isArray(details.props)) {
    for (let i = 0; i < details.props.length; i++) {
      const prop = details.props[i];
      if (prop.name && typeof prop.name === 'string') {
        textsToTranslate.push(prop.name);
        fieldMap.push({ field: 'props', subField: 'name', subIndex: i, index: textsToTranslate.length - 1 });
      }
      if (prop.value && typeof prop.value === 'string') {
        textsToTranslate.push(prop.value);
        fieldMap.push({ field: 'props', subField: 'value', subIndex: i, index: textsToTranslate.length - 1 });
      }
    }
  }
  
  if (textsToTranslate.length === 0) {
    console.log('No text fields to translate');
    return translated;
  }
  
  console.log(`Translating ${textsToTranslate.length} text fields...`);
  
  // Batch translate all collected text
  const translatedTexts = await translateTextsWithGemini(textsToTranslate);
  
  // Store originals and apply translations
  for (const mapping of fieldMap) {
    const translatedText = translatedTexts[mapping.index];
    
    if (mapping.field === 'seller' && mapping.subField) {
      if (!translated.seller) translated.seller = { ...details.seller };
      translated.seller[`${mapping.subField}_original`] = details.seller[mapping.subField];
      translated.seller[mapping.subField] = translatedText;
    } else if (mapping.field === 'props' && mapping.subField !== undefined && mapping.subIndex !== undefined) {
      if (!translated.props) translated.props = details.props.map((p: any) => ({ ...p }));
      translated.props[mapping.subIndex][`${mapping.subField}_original`] = details.props[mapping.subIndex][mapping.subField];
      translated.props[mapping.subIndex][mapping.subField] = translatedText;
    } else {
      translated[`${mapping.field}_original`] = details[mapping.field];
      translated[mapping.field] = translatedText;
    }
  }
  
  console.log(`Translation complete for ${textsToTranslate.length} fields`);
  return translated;
}

// Fetch product details with retry mechanism
async function fetchProductDetailsWithRetry(productId: string, platform: string, maxRetries = 3): Promise<any> {
  const serviceUrl = process.env.TAOBAO_SERVICE_URL || 'http://localhost:8000';
  
  // Extract numeric ID by removing platform prefix (e.g., "taobao_123" -> "123")
  const numericId = productId.includes('_') ? productId.split('_')[1] : productId;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Attempt ${attempt}/${maxRetries}] Fetching details for ${numericId}...`);
      
      const response = await fetch(`${serviceUrl}/product/${numericId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });
      
      if (!response.ok) {
        // If it's a 400 error (data error), don't retry
        if (response.status === 400) {
          console.log(`✗ Product ${numericId} not available (400)`);
          return null;
        }
        throw new Error(`Service returned ${response.status}`);
      }
      
      const details = await response.json();
      console.log(`✓ Successfully fetched details for ${numericId}`);
      return details;
      
    } catch (error) {
      console.error(`✗ Attempt ${attempt} failed for ${numericId}:`, error);
      
      if (attempt === maxRetries) {
        console.error(`✗ All ${maxRetries} attempts failed for ${numericId}`);
        return null;
      }
      
      // Wait before retry (exponential backoff: 2s, 4s, 8s)
      const delay = 2000 * Math.pow(2, attempt - 1);
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return null;
}

// Shared helper: fetch item details for a list of products, save incrementally to file.
// Skips products already present in data.itemDetails.
// Returns the number of successfully fetched items.
async function fetchAndSaveItemDetails(
  data: any,
  products: any[],
  filePath: string,
  maxRetries = 5
): Promise<number> {
  let successfulCount = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const numIid = product.source_id || product.id;
    const platform = product.source || 'taobao';

    if (data.itemDetails[numIid]) {
      console.log(`[${i + 1}/${products.length}] Already cached: ${numIid}`);
      successfulCount++;
      continue;
    }

    console.log(`[${i + 1}/${products.length}] Fetching details for ${numIid}...`);
    const details = await fetchProductDetailsWithRetry(numIid, platform, maxRetries);

    if (details) {
      console.log(`[${i + 1}/${products.length}] Translating details for ${numIid}...`);
      const translated = await translateProductDetails(details);

      data.itemDetails[numIid] = {
        ...translated,
        productId: numIid,
        platform,
        fetchedAt: new Date().toISOString(),
        selectedSecondaryImages: translated.item_imgs?.slice(0, 4).map((img: any) => {
          const url = typeof img === 'string' ? img : img.url;
          return url.startsWith('//') ? `https:${url}` : url;
        }) || [],
      };
      successfulCount++;
    } else {
      console.log(`✗ All ${maxRetries} attempts failed for ${numIid}`);
    }

    // Write after every product so progress survives partial failures
    data.successfulItems = Object.keys(data.itemDetails).length;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  return successfulCount;
}

// POST /api/proposal-details - Create proposal and fetch all item details
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { products, proposalName, clientName, notes, proposalId: clientProposalId, createdBy } = body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { error: 'products array is required and must not be empty' },
        { status: 400 }
      );
    }

    const proposalId = clientProposalId || randomUUID();
    ensureDataDir();

    const filePath = getProposalFilePath(proposalId);
    const data: any = {
      proposalId,
      proposalName: proposalName || `Proposal ${new Date().toLocaleDateString()}`,
      clientName: clientName || '',
      notes: notes || '',
      createdBy: createdBy || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      products: products.map((p: any) => ({
        id: p.id, source_id: p.source_id, source: p.source,
        title: p.title, price: p.price, image_urls: p.image_urls,
        url: p.url, moq: p.moq, seller: p.seller,
      })),
      itemDetails: {},
      totalItems: products.length,
      successfulItems: 0,
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Created proposal file: ${filePath}`);

    const successfulCount = await fetchAndSaveItemDetails(data, products, filePath);
    console.log(`POST complete: ${successfulCount}/${products.length} details fetched`);

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
            selectedSecondaryImages: translatedDetails.item_imgs?.slice(0, 4).map((img: any) => {
              const url = typeof img === 'string' ? img : img.url;
              return url.startsWith('//') ? `https:${url}` : url;
            }) || []
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
    const { proposalId, newProducts } = body;

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
    const existingIds = new Set(data.products.map((p: any) => p.source_id || p.id));
    const toAdd = newProducts.filter((p: any) => !existingIds.has(p.source_id || p.id));

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
      const key = p.source_id || p.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    data.totalItems = data.products.length;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Appended ${toAdd.length} product(s) to proposal ${proposalId} (total: ${data.totalItems})`);

    // Fetch item details in the background — don't block the response
    fetchAndSaveItemDetails(data, toAdd, filePath)
      .then(count => console.log(`PATCH background: ${count}/${toAdd.length} details fetched for ${proposalId}`))
      .catch(err => console.error(`PATCH background fetch error for ${proposalId}:`, err));

    return NextResponse.json({
      success: true,
      added: toAdd.length,
      totalItems: data.totalItems,
      message: `${toAdd.length} product(s) added. Details are being fetched in the background.`,
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

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

// Translate a single text string from Chinese to English
async function translateText(text: string): Promise<string> {
  if (!text || typeof text !== 'string' || text.trim() === '') return text;
  // Skip if text is already mostly English/numbers/URLs
  if (/^[a-zA-Z0-9\s\-_.,\/:;!?@#$%^&*()+=<>\[\]{}|~`'"]+$/.test(text)) return text;
  try {
    const result = await translate(text, { from: 'zh-CN', to: 'en' });
    return result.text || text;
  } catch (error) {
    console.error(`Translation failed for text: "${text.substring(0, 50)}..."`, error);
    return text;
  }
}

// Batch translate an array of strings (uses separator trick for fewer API calls)
async function batchTranslate(texts: string[]): Promise<string[]> {
  if (texts.length === 0) return [];
  
  // Filter out empty/non-translatable texts, keeping track of indices
  const SEPARATOR = ' ||| ';
  const nonEmpty = texts.filter(t => t && typeof t === 'string' && t.trim() !== '');
  
  if (nonEmpty.length === 0) return texts;
  
  // For small batches, translate individually to avoid separator issues
  if (nonEmpty.length <= 3) {
    const results = [...texts];
    for (let i = 0; i < texts.length; i++) {
      if (texts[i] && typeof texts[i] === 'string' && texts[i].trim() !== '') {
        results[i] = await translateText(texts[i]);
      }
    }
    return results;
  }
  
  // For larger batches, join with separator for a single API call
  try {
    const joined = nonEmpty.join(SEPARATOR);
    const result = await translate(joined, { from: 'zh-CN', to: 'en' });
    const translated = (result.text || joined).split(/\s*\|\|\|\s*/);
    
    // Map back to original positions
    const results = [...texts];
    let tIdx = 0;
    for (let i = 0; i < texts.length; i++) {
      if (texts[i] && typeof texts[i] === 'string' && texts[i].trim() !== '') {
        results[i] = (tIdx < translated.length) ? translated[tIdx].trim() : texts[i];
        tIdx++;
      }
    }
    return results;
  } catch (error) {
    console.error('Batch translation failed, falling back to individual:', error);
    // Fallback: translate individually
    const results = [...texts];
    for (let i = 0; i < texts.length; i++) {
      if (texts[i] && typeof texts[i] === 'string' && texts[i].trim() !== '') {
        results[i] = await translateText(texts[i]);
      }
    }
    return results;
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
  const textFields = ['title', 'desc_short', 'description', 'brand'];
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
  const translatedTexts = await batchTranslate(textsToTranslate);
  
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

// POST /api/proposal-details - Save proposal with system-generated ID and fetch all item details
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
    
    // Use client-sent proposalId if provided, otherwise generate UUID
    const proposalId = clientProposalId || randomUUID();
    
    ensureDataDir();
    
    // Save initial proposal data
    const filePath = getProposalFilePath(proposalId);
    const data: any = {
      proposalId,
      proposalName: proposalName || `Proposal ${new Date().toLocaleDateString()}`,
      clientName: clientName || '',
      notes: notes || '',
      createdBy: createdBy || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      products: products.map(p => ({
        id: p.id,
        source_id: p.source_id,
        source: p.source,
        title: p.title,
        price: p.price,
        image_urls: p.image_urls,
        url: p.url,
        moq: p.moq,
        seller: p.seller
      })),
      itemDetails: {},
      totalItems: products.length,
      successfulItems: 0
    };
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Created proposal data file at ${filePath} with ID: ${proposalId}`);
    
    // Fetch all item details sequentially with delays and retries
    console.log(`Fetching details for ${products.length} products...`);
    let successfulCount = 0;
    
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const numIid = product.source_id || product.id; // Use source_id as num_iid
      const platform = product.source || 'taobao';
      
      console.log(`[${i + 1}/${products.length}] Fetching details for ${numIid}...`);
      
      const details = await fetchProductDetailsWithRetry(numIid, platform, 5);
      
      if (details) {
        // Translate all text fields from Chinese to English
        console.log(`[${i + 1}/${products.length}] Translating details for ${numIid}...`);
        const translatedDetails = await translateProductDetails(details);
        
        // Use num_iid (source_id) as the key for item details
        data.itemDetails[numIid] = {
          ...translatedDetails,
          productId: numIid,
          platform,
          fetchedAt: new Date().toISOString(),
          selectedSecondaryImages: translatedDetails.item_imgs?.slice(0, 4).map((img: any) => {
            const url = typeof img === 'string' ? img : img.url;
            return url.startsWith('//') ? `https:${url}` : url;
          }) || []
        };
        successfulCount++;
      } else {
        console.log(`✗ Failed to fetch details for ${numIid} after all retries`);
      }
      
      // Add delay between requests (10 seconds to protect backend service)
      if (i < products.length - 1) {
        console.log(`⏳ Waiting 10 seconds before next request...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
    
    // Update the file with fetched details
    data.successfulItems = successfulCount;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    
    console.log(`Finished fetching details: ${successfulCount}/${products.length} successful`);
    
    return NextResponse.json({
      success: true,
      proposalId,
      totalItems: products.length,
      successfulItems: successfulCount,
      message: `Proposal saved with ${successfulCount}/${products.length} item details fetched.`
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
      
      // Return cached details if available (using num_iid as key)
      if (data.itemDetails[numIid]) {
        return NextResponse.json({
          ...data.itemDetails[numIid],
          cached: true
        });
      }
      
      // If shouldFetch=true, fetch from API and cache
      if (shouldFetch) {
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

// PUT /api/proposal-details - Update proposal details (e.g., save secondary image selection)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { proposalId, productId, selectedSecondaryImages } = body;
    
    if (!proposalId || !productId) {
      return NextResponse.json(
        { error: 'proposalId and productId are required' },
        { status: 400 }
      );
    }
    
    const filePath = getProposalFilePath(proposalId);
    
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'Proposal details not found' },
        { status: 404 }
      );
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const numIid = productId; // productId is the num_iid (source_id)
    
    if (data.itemDetails[numIid]) {
      data.itemDetails[numIid].selectedSecondaryImages = selectedSecondaryImages;
      data.updatedAt = new Date().toISOString();
      
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`Updated secondary image selection for ${numIid}`);
      
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: 'Product details not found in proposal' },
        { status: 404 }
      );
    }
    
  } catch (error) {
    console.error('Error in PUT /api/proposal-details:', error);
    return NextResponse.json(
      { error: 'Failed to update proposal details', details: String(error) },
      { status: 500 }
    );
  }
}

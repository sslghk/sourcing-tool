import fs from 'fs';
import path from 'path';
import translate from 'google-translate-api-x';

const DATA_DIR = path.join(process.cwd(), 'data', 'proposals');

export function getProposalFilePath(proposalId: string) {
  return path.join(DATA_DIR, `${proposalId}.json`);
}

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

export async function translateProductDetails(details: any): Promise<any> {
  if (!details) return details;
  const translated = { ...details };
  const textsToTranslate: string[] = [];
  const fieldMap: { field: string; index: number; subField?: string; subIndex?: number }[] = [];

  const textFields = ['title', 'desc_short', 'description', 'brand', 'category'];
  for (const field of textFields) {
    if (details[field] && typeof details[field] === 'string') {
      textsToTranslate.push(details[field]);
      fieldMap.push({ field, index: textsToTranslate.length - 1 });
    }
  }
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

  if (textsToTranslate.length === 0) return translated;
  const translatedTexts = await translateTextsWithGemini(textsToTranslate);

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
  return translated;
}

export async function fetchProductDetailsWithRetry(productId: string, platform: string, maxRetries = 3): Promise<any> {
  const serviceUrl = process.env.TAOBAO_SERVICE_URL || 'http://localhost:8001';
  const numericId = productId.includes('_') ? productId.split('_')[1] : productId;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[proposal-helpers] [${attempt}/${maxRetries}] Fetching details for ${numericId}...`);
      const response = await fetch(`${serviceUrl}/product/${numericId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        if (response.status === 400) {
          console.log(`[proposal-helpers] ✗ Product ${numericId} not available (400)`);
          return null;
        }
        throw new Error(`Service returned ${response.status}`);
      }
      const details = await response.json();
      console.log(`[proposal-helpers] ✓ Fetched details for ${numericId}`);
      return details;
    } catch (error) {
      console.error(`[proposal-helpers] ✗ Attempt ${attempt} failed for ${numericId}:`, error);
      if (attempt === maxRetries) return null;
      const delay = 2000 * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

export async function fetchAndSaveItemDetails(
  data: any,
  products: any[],
  filePath: string,
  maxRetries = 5,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  let successfulCount = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const numIid = product.source_id || product.id;
    const platform = product.source || 'taobao';

    if (data.itemDetails[numIid]) {
      console.log(`[proposal-helpers] [${i + 1}/${products.length}] Already cached: ${numIid}`);
      successfulCount++;
      onProgress?.(successfulCount, products.length);
      continue;
    }

    console.log(`[proposal-helpers] [${i + 1}/${products.length}] Fetching details for ${numIid}...`);
    const details = await fetchProductDetailsWithRetry(numIid, platform, maxRetries);

    if (details) {
      console.log(`[proposal-helpers] [${i + 1}/${products.length}] Translating details for ${numIid}...`);
      const translated = await translateProductDetails(details);
      data.itemDetails[numIid] = {
        ...translated,
        productId: numIid,
        platform,
        fetchedAt: new Date().toISOString(),
        selectedSecondaryImages: [],
      };
      successfulCount++;
    } else {
      console.log(`[proposal-helpers] ✗ All ${maxRetries} attempts failed for ${numIid}`);
    }

    onProgress?.(successfulCount, products.length);
    data.successfulItems = Object.keys(data.itemDetails).length;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  return successfulCount;
}

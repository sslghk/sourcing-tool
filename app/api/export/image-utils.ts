import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// Disk cache for external images so exports work after first successful fetch
const DISK_CACHE_DIR = path.join(process.cwd(), 'data', 'image-cache');

function getDiskCachePath(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').substring(0, 48);
  return path.join(DISK_CACHE_DIR, `${hash}.jpg`);
}

function readDiskCache(url: string): Buffer | null {
  try {
    const cachePath = getDiskCachePath(url);
    if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath);
  } catch { /* ignore */ }
  return null;
}

function writeDiskCache(url: string, jpegBuffer: Buffer): void {
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    fs.writeFileSync(getDiskCachePath(url), jpegBuffer);
  } catch { /* ignore cache write errors */ }
}

export interface ProcessedImage {
  base64: string;       // data:image/jpeg;base64,... ready for embedding
  width: number;
  height: number;
}

// In-memory cache for processed images (keyed by url + size)
const processedImageCache = new Map<string, ProcessedImage>();

/**
 * Fetch an image, resize it, compress to JPEG, and return base64 + dimensions.
 * This replaces fetchImageAsBase64 + probe-image-size in a single pass.
 */
export async function fetchAndProcessImage(
  imageUrl: string,
  maxDimension: number = 600
): Promise<ProcessedImage | null> {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  // Normalize URL
  let url = imageUrl;
  if (url.startsWith('//')) {
    url = `https:${url}`;
  }

  // Check cache
  const cacheKey = `${url}|${maxDimension}`;
  if (processedImageCache.has(cacheKey)) {
    return processedImageCache.get(cacheKey)!;
  }

  // Handle local static file paths (e.g. /ai-images/... served from public/)
  if (url.startsWith('/')) {
    try {
      const filePath = path.join(process.cwd(), 'public', url);
      const fileBuffer = fs.readFileSync(filePath);
      const outputBuffer = await sharp(fileBuffer)
        .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
      const metadata = await sharp(outputBuffer).metadata();
      const result: ProcessedImage = {
        base64: `data:image/jpeg;base64,${outputBuffer.toString('base64')}`,
        width: metadata.width || 300,
        height: metadata.height || 300,
      };
      processedImageCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`Error reading local image ${url}:`, error);
      return null;
    }
  }

  // Handle base64 data URLs (e.g. from Gemini-generated images)
  if (url.startsWith('data:')) {
    try {
      const base64Data = url.split(',')[1];
      if (!base64Data) return null;
      const inputBuffer = Buffer.from(base64Data, 'base64');
      const processed = sharp(inputBuffer)
        .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 });
      const outputBuffer = await processed.toBuffer();
      const metadata = await sharp(outputBuffer).metadata();
      return {
        base64: `data:image/jpeg;base64,${outputBuffer.toString('base64')}`,
        width: metadata.width || 300,
        height: metadata.height || 300,
      };
    } catch (error) {
      console.error('Error processing base64 image:', error);
      return null;
    }
  }

  // Check disk cache before fetching externally
  const cachedBuffer = readDiskCache(url);
  if (cachedBuffer) {
    try {
      const metadata = await sharp(cachedBuffer).metadata();
      const result: ProcessedImage = {
        base64: `data:image/jpeg;base64,${cachedBuffer.toString('base64')}`,
        width: metadata.width || 300,
        height: metadata.height || 300,
      };
      processedImageCache.set(cacheKey, result);
      return result;
    } catch { /* fall through to re-fetch */ }
  }

  // Fetch with up to 2 retries
  let inputBuffer: Buffer | null = null;
  for (let attempt = 0; attempt < 2 && !inputBuffer; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Referer': 'https://www.taobao.com/',
        },
      });
      if (!response.ok) break;
      inputBuffer = Buffer.from(await response.arrayBuffer());
    } catch (e) {
      if (attempt === 1) console.error(`Fetch failed after retries for ${url}:`, e);
    }
  }
  if (!inputBuffer) return null;

  try {

    // Use sharp to resize + compress in one pipeline
    const processed = sharp(inputBuffer)
      .resize(maxDimension, maxDimension, {
        fit: 'inside',           // Maintain aspect ratio, fit within box
        withoutEnlargement: true // Don't upscale small images
      })
      .jpeg({ quality: 75 }); // Compress to JPEG

    const outputBuffer = await processed.toBuffer();
    if (!outputBuffer || outputBuffer.length === 0) {
      console.error(`sharp returned empty buffer for ${url}`);
      return null;
    }
    const metadata = await sharp(outputBuffer).metadata();

    const result: ProcessedImage = {
      base64: `data:image/jpeg;base64,${outputBuffer.toString('base64')}`,
      width: metadata.width || 300,
      height: metadata.height || 300,
    };

    // Persist to disk so future exports work even if CDN is unreachable
    writeDiskCache(url, outputBuffer);
    processedImageCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`Error processing image ${url}:`, error);
    return null;
  }
}

/**
 * Pre-fetch and process ALL images for a proposal in parallel.
 * Returns a Map<normalizedUrl, ProcessedImage>.
 * 
 * Concurrency is limited to avoid overwhelming the network.
 */
export async function prefetchAllProposalImages(
  proposal: any,
  mainMaxDim: number = 600,
  secondaryMaxDim: number = 300
): Promise<Map<string, ProcessedImage>> {
  const results = new Map<string, ProcessedImage>();

  // Collect all image URLs with their target sizes
  const tasks: { url: string; maxDim: number }[] = [];

  for (const product of proposal.products) {
    // Main image
    if (product.image_urls?.[0]) {
      const mainUrl = normalizeUrl(product.image_urls[0]);
      tasks.push({ url: mainUrl, maxDim: mainMaxDim });
    }

    // Secondary images
    const secondaryUrls = getSecondaryImageUrls(product);
    for (const url of secondaryUrls) {
      tasks.push({ url: normalizeUrl(url), maxDim: secondaryMaxDim });
    }

    // AI-generated images
    const aiUrls = getAIImageUrls(product);
    for (const url of aiUrls) {
      tasks.push({ url: url, maxDim: secondaryMaxDim }); // data: URLs don't need normalizeUrl
    }
  }

  // Deduplicate by url+size
  const uniqueTasks = new Map<string, { url: string; maxDim: number }>();
  for (const task of tasks) {
    const key = `${task.url}|${task.maxDim}`;
    if (!uniqueTasks.has(key)) {
      uniqueTasks.set(key, task);
    }
  }

  console.log(`Pre-fetching ${uniqueTasks.size} unique images (from ${tasks.length} total)...`);
  const startTime = Date.now();

  // Process in batches of 10 for concurrency control
  const BATCH_SIZE = 10;
  const taskArray = Array.from(uniqueTasks.values());

  for (let i = 0; i < taskArray.length; i += BATCH_SIZE) {
    const batch = taskArray.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (task) => {
        const processed = await fetchAndProcessImage(task.url, task.maxDim);
        if (processed) {
          results.set(`${task.url}|${task.maxDim}`, processed);
        }
      })
    );
  }

  console.log(`Pre-fetched ${results.size}/${uniqueTasks.size} images in ${Date.now() - startTime}ms`);
  return results;
}

/**
 * Get a processed image from the prefetch results map.
 */
export function getProcessedImage(
  imageMap: Map<string, ProcessedImage>,
  url: string,
  maxDim: number
): ProcessedImage | null {
  const normalizedUrl = normalizeUrl(url);
  return imageMap.get(`${normalizedUrl}|${maxDim}`) || null;
}

/**
 * Calculate dimensions maintaining aspect ratio to fit within maxWidth x maxHeight.
 */
export function calculateFitDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const aspectRatio = originalWidth / originalHeight;

  let width = maxWidth;
  let height = maxWidth / aspectRatio;

  if (height > maxHeight) {
    height = maxHeight;
    width = maxHeight * aspectRatio;
  }

  return { width, height };
}

/**
 * Normalize URL: add https: prefix if needed.
 */
export function normalizeUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

/**
 * Extract secondary image URLs from a product object.
 */
export function getSecondaryImageUrls(product: any): string[] {
  const selectedImages = product.selectedSecondaryImages || [];
  if (selectedImages.length > 0) {
    return selectedImages.slice(0, 4);
  }

  const cachedImgs = product.cachedDetails?.item_imgs;
  if (cachedImgs && Array.isArray(cachedImgs) && cachedImgs.length > 0) {
    return cachedImgs.slice(0, 4).map((img: any) =>
      typeof img === 'string' ? img : img.url
    );
  }

  return [];
}

/**
 * Extract selected AI-generated image URLs from a product object.
 */
export function getAIImageUrls(product: any): string[] {
  const selected = product.selectedAIImages || [];
  if (selected.length === 0) return [];
  if (typeof selected[0] === 'number') {
    // Index-based: resolve URLs from design_alternatives
    const alternatives = product.aiEnrichment?.design_alternatives || [];
    return (selected as number[])
      .map((idx: number) => alternatives[idx]?.generated_image_url)
      .filter(Boolean)
      .slice(0, 4);
  }
  // Legacy: direct URL strings
  return selected.slice(0, 4);
}

/**
 * Normalize URL for cache key - data URLs are used as-is.
 */
export function normalizeUrlForCache(url: string): string {
  if (url.startsWith('data:')) return url.substring(0, 64); // Use prefix as cache key
  return normalizeUrl(url);
}

import { NextRequest, NextResponse } from 'next/server';
import PptxGenJS from 'pptxgenjs';
import probe from 'probe-image-size';

// Helper function to fetch image as base64
async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    let url = imageUrl;
    if (url.startsWith('//')) {
      url = `https:${url}`;
    }
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error('Error fetching image:', error);
    return null;
  }
}

// Helper function to calculate dimensions maintaining aspect ratio
function calculateAspectRatioDimensions(originalWidth: number, originalHeight: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const aspectRatio = originalWidth / originalHeight;
  
  let width = maxWidth;
  let height = maxWidth / aspectRatio;
  
  if (height > maxHeight) {
    height = maxHeight;
    width = maxHeight * aspectRatio;
  }
  
  return { width, height };
}

// Helper function to get image dimensions from base64
async function getImageDimensions(base64Image: string): Promise<{ width: number; height: number }> {
  try {
    // Extract the base64 data (remove data:image/...;base64, prefix)
    const base64Data = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
    
    const result = await probe('data:image/jpeg;base64,' + base64Data);
    return { width: result.width, height: result.height };
  } catch (error) {
    console.error('Error getting image dimensions:', error);
    // Fallback to 1:1 aspect ratio
    return { width: 300, height: 300 };
  }
}

// Helper function to add image to PPTX with aspect ratio preservation
async function addImageToPptx(slide: any, imageUrl: string, x: number, y: number, maxWidth: number, maxHeight: number) {
  try {
    const base64Image = await fetchImageAsBase64(imageUrl);
    
    if (base64Image) {
      try {
        // Get image dimensions to calculate aspect ratio
        const dimensions = await getImageDimensions(base64Image);
        const { width, height } = calculateAspectRatioDimensions(
          dimensions.width,
          dimensions.height,
          maxWidth,
          maxHeight
        );
        
        // Center the image within the available space
        const xOffset = x + (maxWidth - width) / 2;
        const yOffset = y + (maxHeight - height) / 2;
        
        slide.addImage({
          data: base64Image,
          x: xOffset,
          y: yOffset,
          w: width,
          h: height
        });
      } catch (imgError) {
        console.error('Error adding image to PPTX:', imgError);
        // Fallback to placeholder
        slide.addShape(PptxGenJS.ShapeType.rect, {
          x,
          y,
          w: maxWidth,
          h: maxHeight,
          fill: { color: 'F0F0F0' }
        });
      }
    } else {
      // Fallback to placeholder if image fetch fails
      slide.addShape(PptxGenJS.ShapeType.rect, {
        x,
        y,
        w: maxWidth,
        h: maxHeight,
        fill: { color: 'F0F0F0' }
      });
    }
  } catch (error) {
    console.error('Error in addImageToPptx:', error);
    // Fallback to placeholder
    slide.addShape(PptxGenJS.ShapeType.rect, {
      x,
      y,
      w: maxWidth,
      h: maxHeight,
      fill: { color: 'F0F0F0' }
    });
  }
}

// Helper function to fetch fresh product details with retry logic
async function fetchProductDetails(productId: string, source: string, maxRetries = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Call backend service directly (not through Next.js API route)
      const serviceUrl = process.env.TAOBAO_SERVICE_URL || 'http://localhost:8001';
      const fullUrl = `${serviceUrl}/product/${productId}`;
      console.log(`Attempt ${attempt} - Calling backend directly: ${fullUrl}`);
      
      const response = await fetch(fullUrl);
      
      if (!response.ok) {
        if (attempt < maxRetries) {
          console.log(`Attempt ${attempt} failed for ${productId} with status ${response.status}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
          continue;
        }
        console.error(`Failed to fetch product details for ${productId} after ${maxRetries} attempts: ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      console.log(`Fetched fresh details for ${productId} (attempt ${attempt}):`, data);
      return data;
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`Error fetching product details for ${productId} after ${maxRetries} attempts:`, error);
        return null;
      }
      console.log(`Attempt ${attempt} failed for ${productId}, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  return null;
}

// Helper function to generate item number
function generateItemNumber(createdDate: string, source: string, index: number): string {
  const date = new Date(createdDate);
  const yy = date.getFullYear().toString().slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  
  const sourcePrefix = source.toLowerCase() === 'taobao' ? 'T' : source.charAt(0).toUpperCase();
  const runningNumber = String(index + 1).padStart(3, '0');
  
  return `A${yy}${mm}${dd}-${sourcePrefix}${runningNumber}`;
}

export async function POST(request: NextRequest) {
  try {
    const { proposal, orientation = 'landscape', templateId = 'default' } = await request.json();

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal data is required' },
        { status: 400 }
      );
    }

    // TODO: Custom template support
    // For custom templates (templateId !== 'default'), we need to:
    // 1. Retrieve the template file from templateManager
    // 2. Use a library like 'pptxgenjs' or 'officegen' to modify the template
    // 3. Replace placeholders with actual product data
    // 
    // Current implementation uses default template generation
    // Custom template modification requires additional libraries that can:
    // - Parse existing PPTX files
    // - Find and replace text/image placeholders
    // - Maintain template formatting
    //
    // Recommended approach:
    // - Use placeholder syntax like {{product.title}}, {{product.price}}, etc.
    // - Parse PPTX XML and replace placeholders
    // - For images, replace placeholder images with product images
    
    if (templateId !== 'default') {
      // For now, fall back to default template
      // Custom template support will be implemented when user provides template
      console.log(`Custom template requested: ${templateId}, using default for now`);
    }

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 16:9 landscape
    pptx.author = 'Sourcing Assistant';
    pptx.title = proposal.name;
    
    // ===== TITLE SLIDE =====
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: '0ea5e9' }; // Sky blue
    
    titleSlide.addText(proposal.name, {
      x: 1,
      y: 2,
      w: 11,
      h: 1,
      fontSize: 44,
      bold: true,
      color: 'FFFFFF',
      align: 'center'
    });
    
    if (proposal.client_name) {
      titleSlide.addText(`Client: ${proposal.client_name}`, {
        x: 1,
        y: 3.2,
        w: 11,
        h: 0.5,
        fontSize: 24,
        color: 'FFFFFF',
        align: 'center'
      });
    }
    
    titleSlide.addText(`Status: ${proposal.status.toUpperCase()}`, {
      x: 1,
      y: 4,
      w: 11,
      h: 0.4,
      fontSize: 18,
      color: 'FFFFFF',
      align: 'center'
    });
    
    titleSlide.addText(`Created: ${new Date(proposal.created_at).toLocaleDateString()}`, {
      x: 1,
      y: 4.5,
      w: 11,
      h: 0.4,
      fontSize: 18,
      color: 'FFFFFF',
      align: 'center'
    });
    
    titleSlide.addText(`Total Items: ${proposal.products.length}`, {
      x: 1,
      y: 5,
      w: 11,
      h: 0.4,
      fontSize: 18,
      color: 'FFFFFF',
      align: 'center'
    });

    // ===== PRODUCT SLIDES (1 per product) =====
    for (let index = 0; index < proposal.products.length; index++) {
      const product = proposal.products[index];
      const slide = pptx.addSlide();
      
      // Fetch fresh product details with retry logic
      const freshDetails = await fetchProductDetails(product.source_id, product.source);
      
      // Use fresh details if available, otherwise fall back to cached details
      const detailsToUse = freshDetails || product.cachedDetails || {};
      
      console.log(`Product ${product.source_id}:`, {
        hasFreshDetails: !!freshDetails,
        hasCachedDetails: !!product.cachedDetails,
        cachedItemImgs: product.cachedDetails?.item_imgs?.length || 0,
        productImageUrls: product.image_urls?.length || 0
      });
      
      const itemNumber = generateItemNumber(proposal.created_at, product.source, index);
      
      // Item number in top left
      slide.addText(itemNumber, {
        x: 0.3,
        y: 0.3,
        fontSize: 14,
        bold: true,
        color: '1e293b'
      });
      
      // Left section: Images
      const mainImageSize = 3.5; // Main image size
      const imageStartX = 0.3;
      const imageStartY = 1.2;
      
      // Main image (square container)
      if (product.image_urls && product.image_urls.length > 0) {
        await addImageToPptx(slide, product.image_urls[0], imageStartX, imageStartY, mainImageSize, mainImageSize);
        
        // 3 supporting images vertically aligned to the right of main image
        // Collect all available images from multiple sources
        let allImages: any[] = [];
        
        // Priority 1: item_imgs from fresh details
        if (freshDetails?.item_imgs && Array.isArray(freshDetails.item_imgs) && freshDetails.item_imgs.length > 0) {
          allImages = freshDetails.item_imgs.map((img: any) => img.url || img);
          console.log(`Found ${allImages.length} images from fresh item_imgs for ${product.source_id}`);
        }
        // Priority 2: item_imgs from cached details
        else if (product.cachedDetails?.item_imgs && Array.isArray(product.cachedDetails.item_imgs) && product.cachedDetails.item_imgs.length > 0) {
          allImages = product.cachedDetails.item_imgs.map((img: any) => img.url || img);
          console.log(`Found ${allImages.length} images from cached item_imgs for ${product.source_id}`);
        }
        // Priority 3: product.image_urls (fallback)
        else if (product.image_urls && product.image_urls.length > 0) {
          allImages = [...product.image_urls];
          console.log(`Using ${allImages.length} images from product.image_urls for ${product.source_id}`);
        }
        
        // Take up to 3 additional images (skip the first one as it's used as main image)
        const additionalImages = allImages.slice(1, 4);
        console.log(`Will add ${additionalImages.length} additional images for ${product.source_id}`);
        
        if (additionalImages.length > 0) {
          const smallImageSize = 1.1; // Size for supporting images
          const imageSpacing = 0.15; // Vertical space between images
          const smallImageX = imageStartX + mainImageSize + 0.2; // To the right of main image
          
          for (let i = 0; i < additionalImages.length; i++) {
            const yPos = imageStartY + i * (smallImageSize + imageSpacing);
            let imageUrl: string = additionalImages[i];
            
            // Normalize URL - handle both string and object formats
            if (typeof imageUrl === 'string') {
              if (imageUrl.startsWith('//')) {
                imageUrl = `https:${imageUrl}`;
              }
            } else if (typeof imageUrl === 'object' && imageUrl !== null && 'url' in imageUrl) {
              const urlStr = (imageUrl as any).url;
              imageUrl = urlStr.startsWith('//') ? `https:${urlStr}` : urlStr;
            }
            
            console.log(`Fetching additional image ${i + 1} for ${product.source_id}: ${imageUrl}`);
            
            await addImageToPptx(slide, imageUrl, smallImageX, yPos, smallImageSize, smallImageSize);
          }
        }
      }
      
      // Right section: Details
      const rightSectionX = 5.2;
      const rightSectionWidth = 7.5;
      let currentY = 1.2;
      
      // Product title
      slide.addText(product.title, {
        x: rightSectionX,
        y: currentY,
        w: rightSectionWidth,
        h: 0.6,
        fontSize: 16,
        bold: true,
        color: '1e293b',
        wrap: true
      });
      currentY += 0.8;
      
      // Pricing Information
      const pricingData: any[] = [
        [
          { text: 'Pricing Information', options: { bold: true, fontSize: 11, color: '1e293b' } },
          { text: '', options: {} }
        ],
        [
          { text: 'FOB Price:', options: { bold: true } },
          { text: product.fob ? `${product.fob} ${product.price.currency}` : 'N/A', options: {} }
        ],
        [
          { text: 'ELC:', options: { bold: true } },
          { text: product.elc ? `${product.elc} ${product.price.currency}` : 'N/A', options: {} }
        ],
      ];
      
      slide.addTable(pricingData, {
        x: rightSectionX,
        y: currentY,
        w: rightSectionWidth,
        fontSize: 10,
        border: { pt: 0 },
        margin: 0.05,
        colW: [2, 5.5]
      });
      currentY += 0.6;
      
      // Description - use fresh details, cached details, or product fields
      const description = detailsToUse?.desc_short || product.description_short || product.description;
      if (description) {
        slide.addText('Description:', {
          x: rightSectionX,
          y: currentY,
          w: rightSectionWidth,
          h: 0.3,
          fontSize: 12,
          bold: true,
          color: '1e293b'
        });
        currentY += 0.4;
        
        slide.addText(description.substring(0, 500), {
          x: rightSectionX,
          y: currentY,
          w: rightSectionWidth,
          h: 2.5,
          fontSize: 10,
          color: '475569',
          wrap: true,
          valign: 'top'
        });
      }
      
      // Footer with page number (bottom of slide)
      slide.addText(`Page ${index + 2} of ${proposal.products.length + 1}`, {
        x: 0,
        y: 7.2,
        w: 13,
        h: 0.3,
        fontSize: 10,
        color: '999999',
        align: 'center'
      });
    }

    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;

    return new NextResponse(new Uint8Array(pptxBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${proposal.name.replace(/[^a-z0-9]/gi, '_')}.pptx"`,
      },
    });
  } catch (error) {
    console.error('Error generating PPTX:', error);
    return NextResponse.json(
      { error: 'Failed to generate PPTX', details: String(error) },
      { status: 500 }
    );
  }
}

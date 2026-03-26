import { NextRequest, NextResponse } from 'next/server';
import PptxGenJS from 'pptxgenjs';
import {
  prefetchAllProposalImages,
  getProcessedImage,
  getSecondaryImageUrls,
  getAIImageUrls,
  calculateFitDimensions,
  normalizeUrl,
  type ProcessedImage
} from '../image-utils';

// Add a processed image to a PPTX slide with aspect ratio preservation and centering
function addProcessedImageToSlide(
  slide: any,
  image: ProcessedImage | null,
  x: number, y: number,
  maxWidth: number, maxHeight: number
) {
  if (image) {
    try {
      const { width, height } = calculateFitDimensions(image.width, image.height, maxWidth, maxHeight);
      const xOffset = x + (maxWidth - width) / 2;
      const yOffset = y + (maxHeight - height) / 2;
      slide.addImage({ data: image.base64, x: xOffset, y: yOffset, w: width, h: height });
      return;
    } catch (e) {
      console.error('Error adding image to PPTX:', e);
    }
  }
  // Placeholder fallback
  slide.addShape('rect' as any, {
    x, y, w: maxWidth, h: maxHeight,
    fill: { color: 'F0F0F0' }
  });
}

// Helper function to generate item number
function generateItemNumber(createdDate: string, source: string, index: number): string {
  const date = new Date(createdDate);
  const yy = date.getFullYear().toString().slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  
  const src = (source || 'unknown').toLowerCase();
  const sourcePrefix = src === 'taobao' ? 'T' : (source || 'X').charAt(0).toUpperCase();
  const runningNumber = String(index + 1).padStart(3, '0');
  
  return `A${yy}${mm}${dd}-${sourcePrefix}${runningNumber}`;
}

const MAIN_IMG_MAX = 600;
const SECONDARY_IMG_MAX = 300;

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

    // Pre-fetch and compress ALL images in parallel before generating slides
    console.log('PPTX: Pre-fetching all images...');
    const imageMap = await prefetchAllProposalImages(proposal, MAIN_IMG_MAX, SECONDARY_IMG_MAX);

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
    
    titleSlide.addText(`Status: ${(proposal.status || 'draft').toUpperCase()}`, {
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
      
      // Use cached product details for faster export
      const detailsToUse = product.cachedDetails || {};
      
      console.log(`Product ${product.source_id}: Using cached details (${product.cachedDetails?.item_imgs?.length || 0} images)`);
      
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
      const mainImageSize = 4.0; // Main image size (increased from 3.5)
      const imageStartX = 0.3;
      const imageStartY = 1.0;
      
      // Secondary images layout - fit height to match main image
      const maxSecondaryImages = 4;
      const imageSpacing = 0.12; // Slightly reduced spacing
      // Calculate secondary image size to fit within main image height
      // Total height available = mainImageSize
      // Space needed for N images + (N-1) gaps
      // imageSize = (mainImageSize - (N-1) * spacing) / N
      const secondaryImageSize = (mainImageSize - (maxSecondaryImages - 1) * imageSpacing) / maxSecondaryImages;
      
      // Main image (square container)
      if (product.image_urls && product.image_urls.length > 0) {
        const mainImg = getProcessedImage(imageMap, product.image_urls[0], MAIN_IMG_MAX);
        addProcessedImageToSlide(slide, mainImg, imageStartX, imageStartY, mainImageSize, mainImageSize);
        
        // Secondary images - stacked vertically to the right of main image
        const secondaryUrls = getSecondaryImageUrls(product);
        
        if (secondaryUrls.length > 0) {
          const secondaryImageX = imageStartX + mainImageSize + 0.2;
          
          for (let i = 0; i < Math.min(secondaryUrls.length, maxSecondaryImages); i++) {
            const yPos = imageStartY + i * (secondaryImageSize + imageSpacing);
            const secImg = getProcessedImage(imageMap, secondaryUrls[i], SECONDARY_IMG_MAX);
            addProcessedImageToSlide(slide, secImg, secondaryImageX, yPos, secondaryImageSize, secondaryImageSize);
          }
        }

        // AI images - horizontal row below main image, same size as secondary
        const aiUrls = getAIImageUrls(product);
        if (aiUrls.length > 0) {
          const aiImageY = imageStartY + mainImageSize + 0.15;
          for (let i = 0; i < Math.min(aiUrls.length, 4); i++) {
            const xPos = imageStartX + i * (secondaryImageSize + imageSpacing);
            const aiImg = getProcessedImage(imageMap, aiUrls[i], SECONDARY_IMG_MAX);
            addProcessedImageToSlide(slide, aiImg, xPos, aiImageY, secondaryImageSize, secondaryImageSize);
          }
        }
      }
      
      // Right section: Details - positioned to the right of images
      // Images end at approximately: imageStartX (0.3) + mainImageSize (4.0) + spacing (0.2) + secondaryImageSize (~0.94)
      // So right section should start after ~5.5 inches
      const rightSectionX = 5.8; // Moved right to avoid overlap with images
      const rightSectionWidth = 7.0; // Slightly reduced width
      let currentY = 1.0; // Aligned with image startY
      
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
      
      // Price
      const priceValue = product.price?.current ?? product.price ?? 'N/A';
      const priceCurrency = product.price?.currency ?? '';
      slide.addText(`${priceValue} ${priceCurrency}`.trim(), {
        x: rightSectionX,
        y: currentY,
        w: rightSectionWidth,
        h: 0.4,
        fontSize: 16,
        color: '0ea5e9',
        bold: true
      });
      currentY += 0.4;
      
      // Pricing Information
      const pricingData: any[] = [
        [
          { text: 'Pricing Information', options: { bold: true, fontSize: 11, color: '1e293b' } },
          { text: '', options: {} }
        ],
        [
          { text: 'Platform:', options: { bold: true } },
          { text: product.source ?? 'N/A', options: {} }
        ],
        [
          { text: 'FOB Price:', options: { bold: true } },
          { text: product.fob ? `${product.fob} ${priceCurrency}` : 'N/A', options: {} }
        ],
        [
          { text: 'ELC:', options: { bold: true } },
          { text: product.elc ? `${product.elc} ${priceCurrency}` : 'N/A', options: {} }
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

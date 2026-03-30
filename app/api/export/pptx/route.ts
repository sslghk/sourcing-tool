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

// Helper to get AI image metadata (title, description) from product.aiEnrichment
function getAIImageMetadata(product: any, imageUrl: string) {
  const alternatives = product.aiEnrichment?.design_alternatives || [];
  const match = alternatives.find((alt: any) => alt.generated_image_url === imageUrl);
  return {
    title: match?.concept_title || 'AI Design',
    description: (match?.short_description || '').substring(0, 100),
    rationale: match?.design_rationale || ''
  };
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
    pptx.layout = 'LAYOUT_4x3'; // 4:3 standard aspect ratio
    pptx.author = 'Sourcing Assistant';
    pptx.title = proposal.name;
    
    // ===== TITLE SLIDE =====
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: '0ea5e9' }; // Sky blue
    
    // 4:3 layout is 10x7.5 inches - center content
    const titleWidth = 8;
    const titleX = (10 - titleWidth) / 2; // Center horizontally
    
    titleSlide.addText(proposal.name, {
      x: titleX,
      y: 1.5,
      w: titleWidth,
      h: 1,
      fontSize: 36,
      bold: true,
      color: 'FFFFFF',
      align: 'center'
    });
    
    if (proposal.client_name) {
      titleSlide.addText(`Client: ${proposal.client_name}`, {
        x: titleX,
        y: 2.8,
        w: titleWidth,
        h: 0.5,
        fontSize: 20,
        color: 'FFFFFF',
        align: 'center'
      });
    }
    
    titleSlide.addText(`Status: ${(proposal.status || 'draft').toUpperCase()}`, {
      x: titleX,
      y: 3.5,
      w: titleWidth,
      h: 0.4,
      fontSize: 16,
      color: 'FFFFFF',
      align: 'center'
    });
    
    titleSlide.addText(`Created: ${new Date(proposal.created_at).toLocaleDateString()}`, {
      x: titleX,
      y: 4.0,
      w: titleWidth,
      h: 0.4,
      fontSize: 16,
      color: 'FFFFFF',
      align: 'center'
    });
    
    titleSlide.addText(`Total Items: ${proposal.products.length}`, {
      x: titleX,
      y: 4.5,
      w: titleWidth,
      h: 0.4,
      fontSize: 16,
      color: 'FFFFFF',
      align: 'center'
    });

    // ===== PRODUCT SLIDES (1 per product) =====
    for (let index = 0; index < proposal.products.length; index++) {
      const product = proposal.products[index];
      const slide = pptx.addSlide();
      
      // Header - Creative Concepts reference
      slide.addText('Creative Concepts for Vegetable Plush Toys - Ref. 1688/Taobao', {
        x: 0,
        y: 0.1,
        w: 10,
        h: 0.25,
        fontSize: 10,
        color: '64748B',
        align: 'center'
      });
      
      // Footer - Proposal reference number
      slide.addText('PLN-250302-Alice', {
        x: 0,
        y: 7.4,
        w: 10,
        h: 0.2,
        fontSize: 9,
        color: '64748B',
        align: 'center'
      });
      
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
      
      // Left section: Images - scaled for 4:3 layout (10x7.5 inches) - enlarged 15%
      const mainImageSize = 3.22; // 2.8 * 1.15 = 3.22 inches (enlarged 15%)
      const imageStartX = 0.3;
      const imageStartY = 1.0; // Add 1 line spacing above main photo
      
      // Secondary images layout - fit height to match main image
      const maxSecondaryImages = 4;
      const imageSpacing = 0.08;
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

        // AI images - 4 frames horizontally under main image (doubled size, evenly distributed)
        const aiUrls = getAIImageUrls(product);
        if (aiUrls.length > 0) {
          const frameY = imageStartY + mainImageSize + 0.2; // Add 1 line spacing above concept labels
          const frameWidth = 1.96; // Doubled from 0.98
          const frameHeight = 2.645; // 2.3 * 1.15 = 2.645 (increased 15%)
          // Calculate spacing for even distribution across 10" page width
          // Available: 10 - 0.3 (left margin) - 0.3 (right) = 9.4"
          // 4 frames × 1.96 = 7.84", remaining 1.56" for 3 gaps = 0.52" each
          const frameSpacing = 0.52;
          const maxFrames = 4;
          
          for (let i = 0; i < Math.min(aiUrls.length, maxFrames); i++) {
            const frameX = imageStartX + i * (frameWidth + frameSpacing);
            const metadata = getAIImageMetadata(product, aiUrls[i]);
            
            // Concept label above each frame - centered horizontally
            slide.addText(`Concept ${i + 1}`, {
              x: frameX,
              y: frameY,
              w: frameWidth,
              h: 0.2,
              fontSize: 11,
              bold: true,
              color: '1e293b',
              align: 'center'
            });
            
            // Frame starts below concept label
            const aiFrameY = frameY + 0.22;
            
            // Frame background (light gray border effect)
            slide.addShape('rect' as any, {
              x: frameX,
              y: aiFrameY,
              w: frameWidth,
              h: frameHeight,
              fill: { color: 'F8FAFC' },
              line: { color: 'E2E8F0', width: 1 }
            });
            
            // Title at top - 10px font
            slide.addText(metadata.title, {
              x: frameX + 0.05,
              y: aiFrameY + 0.05,
              w: frameWidth - 0.1,
              h: 0.35,
              fontSize: 10,
              bold: true,
              color: '1e293b',
              align: 'center',
              wrap: true
            });
            
            // Image in middle (fitted to frame)
            const imgMaxWidth = frameWidth - 0.15;
            const imgMaxHeight = 1.5;
            const imgY = aiFrameY + 0.42;
            const aiImg = getProcessedImage(imageMap, aiUrls[i], SECONDARY_IMG_MAX);
            addProcessedImageToSlide(slide, aiImg, frameX + 0.075, imgY, imgMaxWidth, imgMaxHeight);
            
            // Description - bottom of text box is 0.1" (10px) above frame bottom
            slide.addText(metadata.description, {
              x: frameX + 0.05,
              y: aiFrameY + frameHeight - 0.6,
              w: frameWidth - 0.1,
              h: 0.5,
              fontSize: 10,
              color: '64748B',
              align: 'center',
              wrap: true,
              shrinkText: true
            });
          }
        }
      }
      
      // Right section: Details - adjusted for enlarged images
      // Images end at approximately: 0.3 + 3.22 (main) + 0.15 (spacing) + ~0.76 (secondary) = ~4.4 inches
      const rightSectionX = 4.6; // Position after enlarged images
      const rightSectionWidth = 5.1; // Fits within 10 inch width
      let currentY = 1.0; // Aligned with image startY (with 1 line spacing)
      
      // Product title - reduced to 11px, auto shrink to fit
      slide.addText(product.title, {
        x: rightSectionX,
        y: currentY,
        w: rightSectionWidth,
        h: 0.5,
        fontSize: 11,
        bold: true,
        color: '1e293b',
        wrap: true,
        shrinkText: true
      });
      currentY += 0.6;
      
      // Pricing Information - compact layout (price shown next to Pricing label)
      const priceValue = product.price?.current ?? product.price ?? 'N/A';
      const priceCurrency = product.price?.currency ?? '';
      const pricingData: any[] = [
        [
          { text: 'Pricing:', options: { bold: true, fontSize: 9, color: '1e293b' } },
          { text: `${priceValue} ${priceCurrency}`.trim(), options: { fontSize: 9, color: '0ea5e9', bold: true } }
        ],
        [
          { text: 'FOB:', options: { bold: true, fontSize: 9 } },
          { text: product.fob ? `${product.fob} ${priceCurrency}` : 'N/A', options: { fontSize: 9 } }
        ],
        [
          { text: 'ELC:', options: { bold: true, fontSize: 9 } },
          { text: product.elc ? `${product.elc} ${priceCurrency}` : 'N/A', options: { fontSize: 9 } }
        ],
      ];
      
      slide.addTable(pricingData, {
        x: rightSectionX,
        y: currentY,
        w: rightSectionWidth,
        fontSize: 9,
        border: { pt: 0 },
        margin: 0.03,
        colW: [1.2, 4]
      });
      currentY += 0.5;
      
      // Description - shortened for 4:3 layout
      const description = detailsToUse?.desc_short || product.description_short || product.description;
      if (description) {
        slide.addText('Description:', {
          x: rightSectionX,
          y: currentY,
          w: rightSectionWidth,
          h: 0.22,
          fontSize: 9,
          bold: true,
          color: '1e293b'
        });
        currentY += 0.28;
        
        // Shortened description for 4:3 layout, auto shrink to fit
        slide.addText(description.substring(0, 250), {
          x: rightSectionX,
          y: currentY,
          w: rightSectionWidth,
          h: 1.8,
          fontSize: 8,
          color: '475569',
          wrap: true,
          valign: 'top',
          shrinkText: true
        });
      }
      
      // Footer with page number (bottom of slide for 4:3)
      slide.addText(`Page ${index + 2} of ${proposal.products.length + 1}`, {
        x: 4,
        y: 7.2,
        w: 2,
        h: 0.25,
        fontSize: 9,
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

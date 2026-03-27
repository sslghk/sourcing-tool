import { NextRequest, NextResponse } from 'next/server';
import jsPDF from 'jspdf';
import {
  prefetchAllProposalImages,
  getProcessedImage,
  getSecondaryImageUrls,
  getAIImageUrls,
  calculateFitDimensions,
  normalizeUrl,
  type ProcessedImage
} from '../image-utils';

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

// Add a processed image to PDF with aspect ratio preservation and centering
function addProcessedImageToPDF(
  doc: jsPDF,
  image: ProcessedImage | null,
  x: number, y: number,
  maxWidth: number, maxHeight: number
) {
  if (image) {
    try {
      const { width, height } = calculateFitDimensions(image.width, image.height, maxWidth, maxHeight);
      const xOffset = x + (maxWidth - width) / 2;
      const yOffset = y + (maxHeight - height) / 2;
      doc.addImage(image.base64, 'JPEG', xOffset, yOffset, width, height);
      return;
    } catch (e) {
      console.error('Error adding image to PDF:', e);
    }
  }
  // Placeholder fallback
  doc.setFillColor(240, 240, 240);
  doc.rect(x, y, maxWidth, maxHeight, 'F');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Image', x + maxWidth / 2, y + maxHeight / 2, { align: 'center' });
}

const MAIN_IMG_MAX = 600;
const SECONDARY_IMG_MAX = 300;

export async function POST(request: NextRequest) {
  try {
    const { proposal, orientation = 'landscape' } = await request.json();

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal data is required' },
        { status: 400 }
      );
    }

    // Pre-fetch and compress ALL images in parallel before generating pages
    console.log('PDF: Pre-fetching all images...');
    const imageMap = await prefetchAllProposalImages(proposal, MAIN_IMG_MAX, SECONDARY_IMG_MAX);

    const doc = new jsPDF({
      orientation: orientation,
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;

    // ===== TITLE PAGE =====
    doc.setFillColor(14, 165, 233); // Sky blue
    doc.rect(0, 0, pageWidth, pageHeight, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(36);
    doc.text(proposal.name, pageWidth / 2, pageHeight / 2 - 20, { align: 'center' });
    
    if (proposal.client_name) {
      doc.setFontSize(20);
      doc.text(`Client: ${proposal.client_name}`, pageWidth / 2, pageHeight / 2 + 10, { align: 'center' });
    }
    
    doc.setFontSize(14);
    doc.text(`Status: ${(proposal.status || 'draft').toUpperCase()}`, pageWidth / 2, pageHeight / 2 + 25, { align: 'center' });
    doc.text(`Created: ${new Date(proposal.created_at).toLocaleDateString()}`, pageWidth / 2, pageHeight / 2 + 35, { align: 'center' });
    doc.text(`Total Items: ${proposal.products.length}`, pageWidth / 2, pageHeight / 2 + 45, { align: 'center' });

    // ===== PRODUCT PAGES =====
    for (let index = 0; index < proposal.products.length; index++) {
      const product = proposal.products[index];
      doc.addPage();
      doc.setTextColor(0, 0, 0);
      
      const itemNumber = generateItemNumber(proposal.created_at, product.source, index);
      
      // Item number in top left - moved up to avoid overlap
      doc.setFontSize(12);
      doc.setFont('calibri', 'bold');
      doc.text(itemNumber, margin, margin + 2);
      
      // Left section: Images (convert PPTX coordinates to PDF mm)
      // PPTX uses inches, PDF uses mm. Convert: 1 inch = 25.4mm
      // Matching PPTX 4:3 layout: main image 3.22", startY 0.8"
      const imageStartX = 0.3 * 25.4; // ~7.6mm
      const imageStartY = 1.0 * 25.4; // ~25.4mm (moved down to avoid item number overlap)
      const mainImageSize = 3.22 * 25.4; // ~81.8mm (matches PPTX)
      
      // Secondary images layout - fit height to match main image
      const maxSecondaryImages = 4;
      const imageSpacing = 0.08 * 25.4; // ~2mm (matches PPTX)
      // Calculate secondary image size to fit within main image height
      const secondaryImageSize = (mainImageSize - (maxSecondaryImages - 1) * imageSpacing) / maxSecondaryImages;
      
      // Main image
      if (product.image_urls && product.image_urls.length > 0) {
        const mainImg = getProcessedImage(imageMap, product.image_urls[0], MAIN_IMG_MAX);
        addProcessedImageToPDF(doc, mainImg, imageStartX, imageStartY, mainImageSize, mainImageSize);
        
        // Secondary images - stacked vertically to the right of main image
        const secondaryUrls = getSecondaryImageUrls(product);
        
        if (secondaryUrls.length > 0) {
          const secondaryImageX = imageStartX + mainImageSize + (0.2 * 25.4);
          
          for (let i = 0; i < Math.min(secondaryUrls.length, maxSecondaryImages); i++) {
            const yPos = imageStartY + i * (secondaryImageSize + imageSpacing);
            const secImg = getProcessedImage(imageMap, secondaryUrls[i], SECONDARY_IMG_MAX);
            addProcessedImageToPDF(doc, secImg, secondaryImageX, yPos, secondaryImageSize, secondaryImageSize);
          }
        }

        // AI images - 4 frames horizontally under main image (enlarged 20%, evenly distributed)
        const aiUrls = getAIImageUrls(product);
        if (aiUrls.length > 0) {
          // Title line above AI photos with increased spacing
          const titleY = imageStartY + mainImageSize + (0.35 * 25.4);
          doc.setFontSize(11);
          doc.setFont('calibri', 'bold');
          doc.setTextColor(30, 41, 59);
          doc.text('New concepts', imageStartX, titleY);
          
          // Frame Y position with spacing below "New concepts"
          const frameY = titleY + (0.25 * 25.4);
          // Even distribution across page: from left margin (10mm) to right section (118mm) = 108mm
          // Width: 55mm each (130% increase from 24mm)
          // 4 frames × 55mm = 220mm, available width 108mm
          // This exceeds available space, so frames will extend beyond right section
          // Calculate spacing to evenly distribute across full page width (190mm)
          const frameWidth = 55; // ~2.17"
          const frameHeight = 2.875 * 25.4; // 2.5" + 15% = 2.875"
          const maxFrames = 4;
          // Distribute across full page width minus margins (190 - 20 = 170mm)
          const totalFramesWidth = maxFrames * frameWidth; // 220mm
          const remainingSpace = (pageWidth - 20) - totalFramesWidth; // ~-30mm (will use negative spacing or overflow)
          const frameSpacing = remainingSpace > 0 ? remainingSpace / (maxFrames - 1) : 0; // no spacing if too wide
          const startX = 10; // Start from left margin
          
          for (let i = 0; i < Math.min(aiUrls.length, maxFrames); i++) {
            const frameX = startX + i * (frameWidth + frameSpacing);
            const metadata = getAIImageMetadata(product, aiUrls[i]);
            
            // Frame border (light gray)
            doc.setDrawColor(226, 232, 240);
            doc.setFillColor(248, 250, 252);
            doc.rect(frameX, frameY, frameWidth, frameHeight, 'FD');
            
            // Title at top - auto fit font size
            const titleMaxWidth = frameWidth - 4;
            let titleFontSize = 10;
            doc.setFontSize(titleFontSize);
            doc.setFont('calibri', 'bold');
            doc.setTextColor(30, 41, 59);
            let titleLines = doc.splitTextToSize(metadata.title, titleMaxWidth);
            // Reduce font size if too many lines
            while (titleLines.length > 2 && titleFontSize > 6) {
              titleFontSize -= 1;
              doc.setFontSize(titleFontSize);
              titleLines = doc.splitTextToSize(metadata.title, titleMaxWidth);
            }
            doc.text(titleLines.slice(0, 2), frameX + frameWidth / 2, frameY + 6, { align: 'center' });
            
            // Image in middle (fitted to frame)
            const imgMaxWidth = frameWidth - 4;
            const imgMaxHeight = 1.8 * 25.4;
            const imgY = frameY + 10;
            const aiImg = getProcessedImage(imageMap, aiUrls[i], SECONDARY_IMG_MAX);
            addProcessedImageToPDF(doc, aiImg, frameX + 2, imgY, imgMaxWidth, imgMaxHeight);
            
            // Description at bottom - auto fit font size
            const descMaxWidth = frameWidth - 4;
            let descFontSize = 10;
            doc.setFontSize(descFontSize);
            doc.setFont('calibri', 'normal');
            doc.setTextColor(100, 116, 139);
            let descLines = doc.splitTextToSize(metadata.description, descMaxWidth);
            // Reduce font size if too many lines to fit in frame
            while (descLines.length > 3 && descFontSize > 6) {
              descFontSize -= 1;
              doc.setFontSize(descFontSize);
              descLines = doc.splitTextToSize(metadata.description, descMaxWidth);
            }
            // Text box sized for exactly 3 lines, top-aligned, bottom 3.5mm above frame bottom
            // jsPDF text y is the baseline of the first line
            const descLineHeight = descFontSize * 0.45; // line height in mm for current font size
            const textBoxHeight = 3 * descLineHeight; // height for 3 lines
            const textBoxBottom = frameY + frameHeight - 3.5; // 3.5mm (10px) above frame bottom
            const textBoxTop = textBoxBottom - textBoxHeight;
            const descStartY = textBoxTop + descLineHeight; // first baseline = top + 1 line height
            doc.text(descLines.slice(0, 3), frameX + frameWidth / 2, descStartY, { align: 'center', lineHeightFactor: 1.2 });
          }
        }
      }
      
      // Right section: Details (positioned to the right of images)
      // Start text aligned with top of main photo
      const rightSectionX = 118; // ~4.6 inches, matches PPTX positioning
      const rightSectionWidth = pageWidth - rightSectionX - margin; // Use remaining width
      let currentY = imageStartY + 3.5; // Aligned with top of main photo, 1 line lower
      
      // Product title - auto fit to box size
      let titleFontSize = 11;
      doc.setFontSize(titleFontSize);
      doc.setFont('calibri', 'bold');
      let titleLines = doc.splitTextToSize(product.title, rightSectionWidth);
      // Reduce font size if too many lines
      while (titleLines.length > 3 && titleFontSize > 8) {
        titleFontSize -= 1;
        doc.setFontSize(titleFontSize);
        titleLines = doc.splitTextToSize(product.title, rightSectionWidth);
      }
      doc.text(titleLines.slice(0, 3), rightSectionX, currentY);
      currentY += Math.min(titleLines.length, 3) * 3.5 + 2;
      
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);
      doc.setFont('calibri', 'normal');
      
      // Pricing - label and price on same line, aligned left
      const priceValue = product.price?.current ?? product.price ?? 'N/A';
      const priceCurrency = product.price?.currency ?? '';
      const priceText = `${priceValue} ${priceCurrency}`.trim();
      currentY += 3.5; // single line spacing above Pricing
      doc.setFont('calibri', 'bold');
      doc.text('Pricing:', rightSectionX, currentY);
      doc.setFont('calibri', 'normal');
      doc.setTextColor(14, 165, 233);
      doc.text(priceText, rightSectionX + 18, currentY);
      doc.setTextColor(0, 0, 0);
      currentY += 0.25 * 25.4;
      
      // FOB
      doc.setFont('calibri', 'bold');
      doc.text('FOB:', rightSectionX, currentY);
      doc.setFont('calibri', 'normal');
      doc.text(product.fob ? `${product.fob} ${priceCurrency}` : 'N/A', rightSectionX + 18, currentY);
      currentY += 0.15 * 25.4;
      
      // ELC
      doc.setFont('calibri', 'bold');
      doc.text('ELC:', rightSectionX, currentY);
      doc.setFont('calibri', 'normal');
      doc.text(product.elc ? `${product.elc} ${priceCurrency}` : 'N/A', rightSectionX + 18, currentY);
      currentY += 0.15 * 25.4;
      
      // Description - auto fit to box size
      const description = product.cachedDetails?.desc_short || product.description_short || product.description;
      if (description) {
        doc.setFont('calibri', 'bold');
        doc.setFontSize(9);
        doc.text('Description:', rightSectionX, currentY);
        currentY += 0.28 * 25.4;
        doc.setFont('calibri', 'normal');
        
        // Auto fit description text
        let descFontSize = 8;
        const maxDescHeight = pageHeight - currentY - 25;
        doc.setFontSize(descFontSize);
        let descLines = doc.splitTextToSize(description.substring(0, 250), rightSectionWidth);
        // Reduce font size if too many lines
        while ((descLines.length * 3.5 > maxDescHeight) && descFontSize > 6) {
          descFontSize -= 1;
          doc.setFontSize(descFontSize);
          descLines = doc.splitTextToSize(description.substring(0, 250), rightSectionWidth);
        }
        const maxLines = Math.floor(maxDescHeight / 3.5);
        doc.text(descLines.slice(0, maxLines), rightSectionX, currentY);
      }
      
      // Footer with page number (bottom of page)
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${index + 2} of ${proposal.products.length + 1}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${proposal.name.replace(/[^a-z0-9]/gi, '_')}.pdf"`,
      },
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF', details: String(error) },
      { status: 500 }
    );
  }
}

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
    doc.text(`Status: ${proposal.status.toUpperCase()}`, pageWidth / 2, pageHeight / 2 + 25, { align: 'center' });
    doc.text(`Created: ${new Date(proposal.created_at).toLocaleDateString()}`, pageWidth / 2, pageHeight / 2 + 35, { align: 'center' });
    doc.text(`Total Items: ${proposal.products.length}`, pageWidth / 2, pageHeight / 2 + 45, { align: 'center' });

    // ===== PRODUCT PAGES =====
    for (let index = 0; index < proposal.products.length; index++) {
      const product = proposal.products[index];
      doc.addPage();
      doc.setTextColor(0, 0, 0);
      
      const itemNumber = generateItemNumber(proposal.created_at, product.source, index);
      
      // Item number in top left
      doc.setFontSize(12);
      doc.setFont('calibri', 'bold');
      doc.text(itemNumber, margin, margin + 5);
      
      // Left section: Images (convert PPTX coordinates to PDF mm)
      // PPTX uses inches, PDF uses mm. Convert: 1 inch = 25.4mm
      const imageStartX = 0.3 * 25.4; // ~7.6mm
      const imageStartY = 1.0 * 25.4; // ~25.4mm (adjusted to match PPTX)
      const mainImageSize = 4.0 * 25.4; // 101.6mm (increased to match PPTX)
      
      // Secondary images layout - fit height to match main image
      const maxSecondaryImages = 4;
      const imageSpacing = 0.12 * 25.4; // ~3mm
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

        // AI images - horizontal row below main image, same size as secondary
        const aiUrls = getAIImageUrls(product);
        if (aiUrls.length > 0) {
          const aiImageY = imageStartY + mainImageSize + (0.15 * 25.4);
          for (let i = 0; i < Math.min(aiUrls.length, 4); i++) {
            const xPos = imageStartX + i * (secondaryImageSize + imageSpacing);
            const aiImg = getProcessedImage(imageMap, aiUrls[i], SECONDARY_IMG_MAX);
            addProcessedImageToPDF(doc, aiImg, xPos, aiImageY, secondaryImageSize, secondaryImageSize);
          }
        }
      }
      
      // Right section: Details (positioned to the right of images)
      // Images end at approximately: 7.6mm + 101.6mm (main) + 5mm (spacing) + ~23mm (secondary) = ~137mm
      // So text section should start after ~140mm
      const rightSectionX = 145; // ~5.7 inches, safely to the right of images
      const rightSectionWidth = pageWidth - rightSectionX - margin; // Use remaining width
      let currentY = imageStartY; // Align with image start
      
      // Product title
      doc.setFontSize(12); // Changed from 16 to 12
      doc.setFont('calibri', 'bold'); // Changed from helvetica to calibri
      const titleLines = doc.splitTextToSize(product.title, rightSectionWidth);
      doc.text(titleLines, rightSectionX, currentY);
      currentY += 0.8 * 25.4; // Same as PPTX (0.8 inches)
      
      // Price
      doc.setFontSize(12); // Changed from 16 to 12
      doc.setFont('calibri', 'bold'); // Changed from helvetica to calibri
      doc.setTextColor(14, 165, 233);
      doc.text(`${product.price.current} ${product.price.currency}`, rightSectionX, currentY);
      currentY += 0.4 * 25.4; // Same as PPTX (0.4 inches)
      
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10); // Same as PPTX
      doc.setFont('calibri', 'normal'); // Changed from helvetica to calibri
      
      // Pricing Information - match PPTX simple text layout
      doc.setFont('calibri', 'bold'); // Changed from helvetica to calibri
      doc.text('Pricing Information', rightSectionX, currentY);
      currentY += 0.25 * 25.4; // Same as PPTX (0.25 inches)
      doc.setFont('calibri', 'normal'); // Changed from helvetica to calibri
      
      // Platform
      doc.text(`Platform: ${product.source}`, rightSectionX, currentY);
      currentY += 0.15 * 25.4; // Same as PPTX (0.15 inches)
      
      // FOB Price
      doc.setFont('calibri', 'bold'); // Changed from helvetica to calibri
      doc.text('FOB Price:', rightSectionX, currentY);
      doc.setFont('calibri', 'normal'); // Changed from helvetica to calibri
      doc.text(product.fob ? `${product.fob} ${product.price.currency}` : 'N/A', rightSectionX + 35, currentY);
      currentY += 0.15 * 25.4; // Same as PPTX (0.15 inches)
      
      // ELC
      doc.setFont('calibri', 'bold'); // Changed from helvetica to calibri
      doc.text('ELC:', rightSectionX, currentY);
      doc.setFont('calibri', 'normal'); // Changed from helvetica to calibri
      doc.text(product.elc ? `${product.elc} ${product.price.currency}` : 'N/A', rightSectionX + 35, currentY);
      currentY += 0.15 * 25.4; // Same as PPTX (0.15 inches)
      
      // Description - use fresh details, cached details, or product fields
      const description = product.cachedDetails?.desc_short || product.description_short || product.description;
      if (description) {
        doc.setFont('calibri', 'bold'); // Changed from helvetica to calibri
        doc.text('Description:', rightSectionX, currentY);
        currentY += 0.3 * 25.4; // Same as PPTX (0.3 inches)
        doc.setFont('calibri', 'normal'); // Changed from helvetica to calibri
        doc.setFontSize(10); // Changed from 12 to 10
        const descLines = doc.splitTextToSize(description, rightSectionWidth);
        const maxLines = Math.floor((pageHeight - currentY - 20) / 4);
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

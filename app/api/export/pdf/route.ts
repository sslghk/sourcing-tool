import { NextRequest, NextResponse } from 'next/server';
import jsPDF from 'jspdf';
import probe from 'probe-image-size';

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

// Helper function to fetch image as base64
async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    // Ensure URL has protocol
    let url = imageUrl;
    if (url.startsWith('//')) {
      url = `https:${url}`;
    }
    
    // Fetch the image
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    
    // Determine image type from URL or content-type
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const imageType = contentType.split('/')[1] || 'jpeg';
    
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

// Helper function to add image to PDF with aspect ratio preservation
async function addImageToPDF(doc: jsPDF, imageUrl: string, x: number, y: number, maxWidth: number, maxHeight: number) {
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
        
        doc.addImage(base64Image, 'JPEG', xOffset, yOffset, width, height);
      } catch (imgError) {
        console.error('Error adding image to PDF:', imgError);
        // Fallback to placeholder
        doc.setFillColor(240, 240, 240);
        doc.rect(x, y, maxWidth, maxHeight, 'F');
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('Image', x + maxWidth / 2, y + maxHeight / 2, { align: 'center' });
      }
    } else {
      // Fallback to placeholder if image fetch fails
      doc.setFillColor(240, 240, 240);
      doc.rect(x, y, maxWidth, maxHeight, 'F');
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text('Image', x + maxWidth / 2, y + maxHeight / 2, { align: 'center' });
    }
  } catch (error) {
    console.error('Error in addImageToPDF:', error);
    // Fallback to placeholder
    doc.setFillColor(240, 240, 240);
    doc.rect(x, y, maxWidth, maxHeight, 'F');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Image', x + maxWidth / 2, y + maxHeight / 2, { align: 'center' });
  }
}

// In-memory cache for images to avoid redundant fetches
const imageCache = new Map<string, string>();

// Helper function to fetch multiple images in parallel with caching
async function fetchImagesInParallel(imageUrls: string[]): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  
  // Filter out URLs that are already cached
  const urlsToFetch = imageUrls.filter(url => {
    if (imageCache.has(url)) {
      results.set(url, imageCache.get(url)!);
      return false;
    }
    return true;
  });
  
  if (urlsToFetch.length === 0) {
    return results;
  }
  
  // Fetch all uncached images in parallel
  const fetchPromises = urlsToFetch.map(async (url) => {
    try {
      const base64Image = await fetchImageAsBase64(url);
      if (base64Image) {
        imageCache.set(url, base64Image);
      }
      results.set(url, base64Image);
    } catch (error) {
      console.error(`Error fetching image ${url}:`, error);
      results.set(url, null);
    }
  });
  
  await Promise.all(fetchPromises);
  return results;
}

export async function POST(request: NextRequest) {
  try {
    const { proposal, orientation = 'landscape' } = await request.json();

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal data is required' },
        { status: 400 }
      );
    }

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
      doc.setFont('helvetica', 'bold');
      doc.text(itemNumber, margin, margin + 5);
      
      // Left half: Images
      const leftHalfWidth = (pageWidth - 3 * margin) / 2;
      const imageStartY = margin + 15;
      const imageHeight = 60;
      
      // Main image
      if (product.image_urls && product.image_urls.length > 0) {
        await addImageToPDF(doc, product.image_urls[0], margin, imageStartY, leftHalfWidth, imageHeight);
        
        // Use selected secondary images if available, otherwise use cachedDetails
        const selectedImages = product.selectedSecondaryImages || [];
        const additionalImages = selectedImages.length > 0 
          ? selectedImages.map((url: string) => ({ url }))
          : (product.cachedDetails?.item_imgs || []);
        
        if (additionalImages.length > 0) {
          // Take up to 4 additional images
          const imagesToShow = additionalImages.slice(0, 4);
          const smallImageSize = leftHalfWidth / 4; // 1/4 of main image width
          const additionalImagesY = imageStartY + imageHeight + 5;
          
          // Normalize URLs
          const imageUrls = imagesToShow.map((img: { url: string }) => {
            const url = img.url.startsWith('//') ? `https:${img.url}` : img.url;
            return url;
          });
          
          // Fetch all images in parallel
          const imageResults = await fetchImagesInParallel(imageUrls);
          
          // Add images to PDF
          for (let i = 0; i < imagesToShow.length; i++) {
            const col = i % 4;
            const xPos = margin + col * smallImageSize;
            const imageUrl = imageUrls[i];
            const base64Image = imageResults.get(imageUrl);
            
            if (base64Image) {
              try {
                const dimensions = await getImageDimensions(base64Image);
                const { width, height } = calculateAspectRatioDimensions(
                  dimensions.width,
                  dimensions.height,
                  smallImageSize,
                  smallImageSize
                );
                
                // Center the image within the available space
                const xOffset = xPos + (smallImageSize - width) / 2;
                const yOffset = additionalImagesY + (smallImageSize - height) / 2;
                
                doc.addImage(base64Image, 'JPEG', xOffset, yOffset, width, height);
              } catch (imgError) {
                console.error(`Error adding cached image to PDF:`, imgError);
                // Fallback to placeholder
                doc.setFillColor(240, 240, 240);
                doc.rect(xPos, additionalImagesY, smallImageSize, smallImageSize, 'F');
                doc.setFontSize(8);
                doc.setTextColor(150, 150, 150);
                doc.text('Image', xPos + smallImageSize / 2, additionalImagesY + smallImageSize / 2, { align: 'center' });
              }
            } else {
              // Fallback to placeholder if image not available
              doc.setFillColor(240, 240, 240);
              doc.rect(xPos, additionalImagesY, smallImageSize, smallImageSize, 'F');
              doc.setFontSize(8);
              doc.setTextColor(150, 150, 150);
              doc.text('Image', xPos + smallImageSize / 2, additionalImagesY + smallImageSize / 2, { align: 'center' });
            }
          }
        }
      }
      
      // Right half: Details
      const rightHalfX = margin + leftHalfWidth + margin;
      const rightHalfWidth = leftHalfWidth;
      let currentY = imageStartY;
      
      // Product title
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      const titleLines = doc.splitTextToSize(product.title, rightHalfWidth);
      doc.text(titleLines, rightHalfX, currentY);
      currentY += titleLines.length * 6 + 5;
      
      // Price
      doc.setFontSize(16);
      doc.setTextColor(14, 165, 233);
      doc.text(`${product.price.current} ${product.price.currency}`, rightHalfX, currentY);
      currentY += 10;
      
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      
      // Pricing Details
      const pricingDetails = [
        ['Platform:', product.source],
        ['FOB Price:', product.fob ? `${product.fob} ${product.price.currency}` : 'N/A'],
        ['ELC:', product.elc ? `${product.elc} ${product.price.currency}` : 'N/A'],
      ];
      
      doc.setFont('helvetica', 'bold');
      doc.text('Pricing Information', rightHalfX, currentY);
      currentY += 6;
      doc.setFont('helvetica', 'normal');
      
      pricingDetails.forEach(([label, value]) => {
        doc.setFont('helvetica', 'bold');
        doc.text(label, rightHalfX, currentY);
        doc.setFont('helvetica', 'normal');
        doc.text(String(value), rightHalfX + 35, currentY);
        currentY += 5;
      });
      
      currentY += 3;
      
      // Image count
      if (product.image_urls && product.image_urls.length > 0) {
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text(`${product.image_urls.length} product images available`, rightHalfX, currentY);
        currentY += 5;
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
      }
      
      // Description (if available from cached details or product)
      const description = product.cachedDetails?.desc_short || product.description_short || product.description;
      if (description && currentY < pageHeight - 30) {
        doc.setFont('helvetica', 'bold');
        doc.text('Description:', rightHalfX, currentY);
        currentY += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const descLines = doc.splitTextToSize(description, rightHalfWidth);
        const maxLines = Math.floor((pageHeight - currentY - 20) / 4);
        doc.text(descLines.slice(0, maxLines), rightHalfX, currentY);
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

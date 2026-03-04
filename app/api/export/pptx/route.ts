import { NextRequest, NextResponse } from 'next/server';
import PptxGenJS from 'pptxgenjs';

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
    const { proposal, orientation = 'landscape' } = await request.json();

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal data is required' },
        { status: 400 }
      );
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
        const mainImageBase64 = await fetchImageAsBase64(product.image_urls[0]);
        
        if (mainImageBase64) {
          slide.addImage({
            data: mainImageBase64,
            x: imageStartX,
            y: imageStartY,
            w: mainImageSize,
            h: mainImageSize
          });
        } else {
          // Fallback placeholder
          slide.addShape(pptx.ShapeType.rect, {
            x: imageStartX,
            y: imageStartY,
            w: mainImageSize,
            h: mainImageSize,
            fill: { color: 'F0F0F0' }
          });
        }
        
        // 3 supporting images vertically aligned to the right of main image
        const additionalImages = product.cachedDetails?.item_imgs || [];
        if (additionalImages.length > 1) {
          // Skip first image (index 0) and take 3 images
          const imagesToShow = additionalImages.slice(1, 4);
          const smallImageSize = 1.1; // Size for supporting images
          const imageSpacing = 0.15; // Vertical space between images
          const smallImageX = imageStartX + mainImageSize + 0.2; // To the right of main image
          
          for (let i = 0; i < imagesToShow.length; i++) {
            const yPos = imageStartY + i * (smallImageSize + imageSpacing);
            const imageUrl = imagesToShow[i].url.startsWith('//') ? `https:${imagesToShow[i].url}` : imagesToShow[i].url;
            
            const smallImageBase64 = await fetchImageAsBase64(imageUrl);
            
            if (smallImageBase64) {
              slide.addImage({
                data: smallImageBase64,
                x: smallImageX,
                y: yPos,
                w: smallImageSize,
                h: smallImageSize
              });
            } else {
              slide.addShape(pptx.ShapeType.rect, {
                x: smallImageX,
                y: yPos,
                w: smallImageSize,
                h: smallImageSize,
                fill: { color: 'E0E0E0' }
              });
            }
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
      
      // Description
      const description = product.cachedDetails?.desc_short || product.description_short || product.description;
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

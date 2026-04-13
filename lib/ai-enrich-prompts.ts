export function buildEnrichmentPrompt(count: number, userNotes: string): string {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const examples = Array.from({ length: count }, (_, i) => `    {
      "concept_title": "<short distinctive name for Variant ${labels[i] || i + 1}>",
      "generated_image_prompt": "<MUST start with: 'Product photo of [exact product type from original image]:' then describe the specific design changes — color, material, texture, pattern, finish, style. End with: 'White background, professional e-commerce studio lighting, no text, no people, product fills frame.'>",
      "short_description": "<under 20 words>",
      "design_rationale": "<why this variant is commercially compelling>"
    }`).join(',\n');

  return `You are a senior industrial designer for a global product sourcing company. Analyze the product image and generate ${count} DISTINCT design variants.

⚠️ CRITICAL RULES (violations will be rejected):
1. ALL variants MUST be the EXACT SAME product type/category as the original (e.g., if original is a USB cable, ALL variants must be USB cables — not accessories, not cases, not other products)
2. Each variant must look VISUALLY DIFFERENT from the others and from the original
3. The generated_image_prompt must be self-contained and specific enough to recreate the design from text alone — include product type, all key visual features, colors, materials
4. User Notes below MUST be incorporated into the design directions

INPUTS:
- Product Image: (attached)
- User Notes: ${userNotes}

DESIGN DIMENSIONS TO VARY (stay within same product category):
- Color palette / gradient / finish (matte, glossy, metallic, translucent)
- Material texture (braided, silicone, leather-look, frosted)
- Pattern / graphic / motif (geometric, floral, character, minimal)
- Style target (luxury, kids, sporty, eco, retro, futuristic)
- Functional accent (ergonomic grip, extra indicator light, unique connector style)

OUTPUT FORMAT (valid JSON only, no markdown fences):
{
  "original_product": {
    "title": "<short title under 8 words>",
    "description": "<short description under 20 words>",
    "specifications": {
      "dimensions": "<estimated dimensions or N/A>",
      "weight": "<estimated weight or N/A>",
      "materials": "<primary materials or N/A>",
      "other_specs": "<other specs or N/A>"
    }
  },
  "design_alternatives": [
${examples}
  ]
}`;
}

export type Platform = 'taobao' | '1688' | 'temu' | 'amazon';

export interface PriceTier {
  min_quantity: number;
  price: number;
}

export interface Price {
  current: number;
  currency: string;
  original?: number;
  tiers?: PriceTier[];
}

export interface Seller {
  name: string;
  id?: string;
  rating?: number;
  total_sales?: number;
  verification_status?: string;
  location?: string;
}

export interface ProductDTO {
  id: string;
  source: Platform;
  source_id: string;
  title: string;
  description_short?: string;
  description_long?: string;
  price: Price;
  image_urls: string[];
  video_url?: string;
  url: string;
  seller: Seller;
  moq?: number;
  lead_time?: string;
  attributes: Record<string, string>;
  category?: string;
  brand?: string;
  sales_volume?: number;
  review_count?: number;
  rating?: number;
  trend?: TrendData;
  fetched_at: string;
  availability?: 'in_stock' | 'out_of_stock' | 'pre_order';
  cachedDetails?: any; // Cached product details from API
  detailsFetchedAt?: string; // Timestamp when details were fetched
  fob?: number; // FOB (Free On Board) price
  elc?: number; // ELC (Estimated Landed Cost)
  aiEnrichment?: AIEnrichmentData; // AI-generated design alternatives
}

export interface AIEnrichmentData {
  original_product: {
    title: string;
    description: string;
    specifications?: {
      dimensions: string;
      weight: string;
      materials: string;
      other_specs: string;
    };
  };
  design_alternatives: Array<{
    concept_title: string;
    generated_image_prompt: string;
    generated_image_url?: string;
    short_description: string;
    design_rationale: string;
  }>;
  enriched_at: string;
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface TrendMetrics {
  slope: number;
  momentum: number;
  volatility: number;
}

export interface TrendData {
  keyword: string;
  region: string;
  timeframe: string;
  timeseries: TimeSeriesPoint[];
  classification: 'Rising' | 'Stable' | 'Declining' | 'Seasonal';
  metrics: TrendMetrics;
  summary: string;
  related_queries?: Array<{
    query: string;
    value: number;
  }>;
  fetched_at: string;
}

export interface SearchFilters {
  price_min?: number;
  price_max?: number;
  category?: string;
  moq_max?: number;
}

export interface SearchRequest {
  query: string;
  platforms: Platform[];
  filters?: SearchFilters;
  page?: number;
  limit?: number;
}

export interface SearchResponse {
  products: ProductDTO[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
  metadata: {
    searchTime: number;
    platformsQueried: string[];
    platformErrors?: Record<string, string>;
  };
}

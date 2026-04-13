import { ProductDTO } from './product';

export type ProposalStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'archived';

export interface Proposal {
  id: string;
  name: string;
  client_name?: string;
  currency: 'USD' | 'CNY' | 'EUR' | 'GBP';
  notes?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  status: ProposalStatus;
  locked?: boolean;
  batchJobId?: string | null;
}

export interface ProposalProduct {
  id: string;
  proposal_id: string;
  product_data: ProductDTO;
  notes?: string;
  target_price?: number;
  quantity: number;
  position: number;
  created_at: string;
}

export interface ProposalWithProducts extends Proposal {
  products: ProposalProduct[];
}

export interface CreateProposalRequest {
  name: string;
  client_name?: string;
  currency?: 'USD' | 'CNY' | 'EUR' | 'GBP';
  notes?: string;
}

export interface UpdateProposalRequest {
  name?: string;
  client_name?: string;
  currency?: 'USD' | 'CNY' | 'EUR' | 'GBP';
  notes?: string;
  status?: ProposalStatus;
}

export interface AddProductToProposalRequest {
  product_data: ProductDTO;
  notes?: string;
  target_price?: number;
  quantity?: number;
}

export interface UpdateProposalProductRequest {
  notes?: string;
  target_price?: number;
  quantity?: number;
  position?: number;
}

export type ExportFormat = 'pdf' | 'ppt' | 'csv' | 'json';

export interface ExportRequest {
  proposal_id: string;
  format: ExportFormat;
  include_trends?: boolean;
}

export interface ExportRecord {
  id: string;
  proposal_id: string;
  format: ExportFormat;
  file_url?: string;
  file_size?: number;
  created_by?: string;
  created_at: string;
  expires_at?: string;
}

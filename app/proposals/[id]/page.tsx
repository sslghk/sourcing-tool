"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Calendar, DollarSign, Trash2, Edit, Download, FileText, ChevronDown, ChevronUp, Loader2, Upload, CheckCircle2, Package, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProductDTO } from "@/types/product";
import { formatCurrency } from "@/lib/utils";
import { ImageCarouselModal } from "@/components/ui/image-carousel-modal";
import { TemplateManagerDialog } from "@/components/proposals/template-manager-dialog";
import { templateManager, PPTXTemplate } from "@/lib/template-manager";

interface Proposal {
  id: string;
  name: string;
  client_name?: string;
  currency: string;
  status: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  products: ProductDTO[];
  totalItems?: number;
  totalValue?: number;
}

interface ProductDetails {
  title?: string;
  desc_short?: string;
  brand?: string;
  pic_url?: string;
  item_imgs?: Array<{ url: string }>;
  prop_imgs?: Record<string, any>;
  props?: Array<{ name: string; value: string }>;
  moq?: number;
  category_id?: string;
  fav_count?: string | number;
  fans_count?: string | number;
  created_time?: string;
  rating_grade?: string;
  seller?: {
    name: string;
    location: string;
    rating?: number;
  };
  sales_volume?: number;
  description?: string;
}

export default function ProposalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
  const [productDetails, setProductDetails] = useState<Map<string, ProductDetails>>(new Map());
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedClientName, setEditedClientName] = useState("");
  const [editedNotes, setEditedNotes] = useState("");
  const [editedStatus, setEditedStatus] = useState("");
  const [carouselImages, setCarouselImages] = useState<Array<{ url: string }>>([]);
  const [carouselInitialIndex, setCarouselInitialIndex] = useState(0);
  const [isCarouselOpen, setIsCarouselOpen] = useState(false);
  const [loadingAIEnrich, setLoadingAIEnrich] = useState<string | null>(null);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PPTXTemplate | null>(null);
  const [isExportingPPTX, setIsExportingPPTX] = useState(false);
  const [metadataPopupOpen, setMetadataPopupOpen] = useState<string | null>(null);
  const [aiEnrichRemarksOpen, setAiEnrichRemarksOpen] = useState<string | null>(null);
  const [aiEnrichRemarks, setAiEnrichRemarks] = useState<Record<string, string>>({});

  // Fetch product details with retry logic
  const fetchProductDetailsWithRetry = async (productId: string, platform: string, maxRetries = 3): Promise<ProductDetails | null> => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`/api/product-details?productId=${productId}&platform=${platform}`);
        
        if (!response.ok) {
          if (attempt < maxRetries) {
            console.log(`Attempt ${attempt} failed for ${productId}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
            continue;
          }
          throw new Error(`Failed to fetch details after ${maxRetries} attempts`);
        }

        const details = await response.json();
        return details;
      } catch (error) {
        if (attempt === maxRetries) {
          console.error(`Error fetching product details for ${productId} after ${maxRetries} attempts:`, error);
          return null;
        }
      }
    }
    return null;
  };

  // Fetch all product details on load
  const fetchAllProductDetails = async () => {
    if (!proposal) return;

    const detailsToFetch: Array<{ productId: string; product: ProductDTO }> = [];
    
    // Identify products that need details
    proposal.products.forEach(product => {
      const productId = product.source_id;
      
      // Skip if already in memory
      if (productDetails.has(productId)) {
        return;
      }
      
      // Skip if has cached details
      if (product.cachedDetails) {
        const newDetails = new Map(productDetails);
        newDetails.set(productId, product.cachedDetails);
        setProductDetails(newDetails);
        return;
      }
      
      detailsToFetch.push({ productId, product });
    });

    if (detailsToFetch.length === 0) return;

    console.log(`Fetching details for ${detailsToFetch.length} products...`);
    
    // Mark all as loading
    const newLoading = new Set(loadingDetails);
    detailsToFetch.forEach(({ productId }) => newLoading.add(productId));
    setLoadingDetails(newLoading);

    // Fetch all details in parallel
    const results = await Promise.all(
      detailsToFetch.map(async ({ productId, product }) => {
        const details = await fetchProductDetailsWithRetry(productId, product.source);
        return { productId, details };
      })
    );

    // Update state with all fetched details
    const newDetails = new Map(productDetails);
    results.forEach(({ productId, details }) => {
      if (details) {
        newDetails.set(productId, details);
      }
    });
    setProductDetails(newDetails);

    // Save to localStorage for caching
    if (proposal) {
      const cachedDetailsKey = `proposal_details_${proposal.id}`;
      const detailsObj = Object.fromEntries(newDetails);
      localStorage.setItem(cachedDetailsKey, JSON.stringify(detailsObj));
    }

    // Clear loading state
    setLoadingDetails(new Set());
    
    console.log(`Successfully fetched details for ${results.filter(r => r.details).length}/${detailsToFetch.length} products`);
  };

  useEffect(() => {
    loadProposal();
  }, [params.id]);

  // Fetch details for all products on load
  useEffect(() => {
    if (proposal && proposal.products.length > 0) {
      fetchAllProductDetails();
    }
  }, [proposal?.id]);

  const loadProposal = () => {
    try {
      const stored = localStorage.getItem('proposals');
      if (stored) {
        const proposals = JSON.parse(stored);
        const found = proposals.find((p: Proposal) => p.id === params.id);
        if (found) {
          setProposal(found);
          setEditedName(found.name);
          setEditedClientName(found.client_name || "");
          setEditedNotes(found.notes || "");
          setEditedStatus(found.status);
          
          // Load cached product details from localStorage
          const cachedDetailsKey = `proposal_details_${found.id}`;
          const cachedDetailsStr = localStorage.getItem(cachedDetailsKey);
          if (cachedDetailsStr) {
            try {
              const cachedDetailsObj = JSON.parse(cachedDetailsStr);
              setProductDetails(new Map(Object.entries(cachedDetailsObj)));
            } catch (e) {
              console.error('Error loading cached details:', e);
            }
          }
        } else {
          setProposal(null);
        }
      }
    } catch (error) {
      console.error('Error loading proposal:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: "bg-gray-100 text-gray-700 border-gray-200",
      submitted: "bg-blue-100 text-blue-700 border-blue-200",
      approved: "bg-green-100 text-green-700 border-green-200",
      rejected: "bg-red-100 text-red-700 border-red-200",
    };
    return colors[status] || colors.draft;
  };

  const handleSaveEdit = () => {
    if (!proposal || !editedName.trim()) {
      alert('Proposal name is required');
      return;
    }

    const updatedProposal = {
      ...proposal,
      name: editedName,
      client_name: editedClientName,
      notes: editedNotes,
      status: editedStatus,
      updated_at: new Date().toISOString(),
    };

    try {
      const stored = localStorage.getItem('proposals');
      if (stored) {
        const proposals = JSON.parse(stored);
        const index = proposals.findIndex((p: Proposal) => p.id === params.id);
        if (index !== -1) {
          proposals[index] = updatedProposal;
          localStorage.setItem('proposals', JSON.stringify(proposals));
          setProposal(updatedProposal);
          setIsEditing(false);
        }
      }
    } catch (error) {
      console.error('Error updating proposal:', error);
      alert('Failed to update proposal');
    }
  };

  const handleCancelEdit = () => {
    if (proposal) {
      setEditedName(proposal.name);
      setEditedClientName(proposal.client_name || "");
      setEditedNotes(proposal.notes || "");
      setEditedStatus(proposal.status);
    }
    setIsEditing(false);
  };

  const handleExportPDF = async () => {
    if (!proposal) return;

    try {
      const response = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          proposal,
          orientation: 'landscape',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${proposal.name.replace(/[^a-z0-9]/gi, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF. This feature is coming soon!');
    }
  };

  const handleExportPPTX = async (templateId?: string) => {
    if (!proposal) return;

    setIsExportingPPTX(true);
    try {
      const response = await fetch('/api/export/pptx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          proposal,
          orientation: 'landscape',
          templateId: templateId || 'default',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PPTX');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${proposal.name.replace(/[^a-z0-9]/gi, '_')}.pptx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error exporting PPTX:', error);
      alert('Failed to export PPTX');
    } finally {
      setIsExportingPPTX(false);
    }
  };

  const handleExportWithTemplate = () => {
    const templates = [templateManager.getDefaultTemplate(), ...templateManager.getTemplates()];
    
    if (templates.length === 1) {
      // Only default template, export directly
      handleExportPPTX('default');
    } else {
      // Show template selection
      setSelectedTemplate(null);
    }
  };

  const handleDelete = () => {
    if (!confirm('Are you sure you want to delete this proposal?')) return;

    try {
      const stored = localStorage.getItem('proposals');
      if (stored) {
        const proposals = JSON.parse(stored);
        const updated = proposals.filter((p: Proposal) => p.id !== params.id);
        localStorage.setItem('proposals', JSON.stringify(updated));
        router.push('/proposals');
      }
    } catch (error) {
      console.error('Error deleting proposal:', error);
      alert('Failed to delete proposal');
    }
  };

  const toggleRowExpansion = async (productId: string, product: ProductDTO) => {
    const newExpanded = new Set(expandedRows);
    
    if (newExpanded.has(productId)) {
      newExpanded.delete(productId);
      setExpandedRows(newExpanded);
      return;
    }

    newExpanded.add(productId);
    setExpandedRows(newExpanded);

    // Check if details are already in memory or cached with product
    if (!productDetails.has(productId)) {
      // Check if product has cached details
      if (product.cachedDetails) {
        console.log(`Using cached details for ${productId}`);
        const newDetails = new Map(productDetails);
        newDetails.set(productId, product.cachedDetails);
        setProductDetails(newDetails);
        return;
      }

      // Fetch details if not cached
      const newLoading = new Set(loadingDetails);
      newLoading.add(productId);
      setLoadingDetails(newLoading);

      try {
        const response = await fetch(`/api/product-details?productId=${productId}&platform=${product.source}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch details');
        }

        const details = await response.json();
        const newDetails = new Map(productDetails);
        newDetails.set(productId, details);
        setProductDetails(newDetails);
      } catch (error) {
        console.error('Error fetching product details:', error);
      } finally {
        const newLoading = new Set(loadingDetails);
        newLoading.delete(productId);
        setLoadingDetails(newLoading);
      }
    }
  };

  const openImageCarousel = (images: Array<{ url: string }>, initialIndex: number = 0) => {
    setCarouselImages(images);
    setCarouselInitialIndex(initialIndex);
    setIsCarouselOpen(true);
  };

  const updateProductField = (productId: string, field: 'fob' | 'elc', value: string) => {
    if (!proposal) return;

    const numValue = value === '' ? undefined : parseFloat(value);
    
    const updatedProducts = proposal.products.map(p => 
      p.id === productId ? { ...p, [field]: numValue } : p
    );

    const updatedProposal = {
      ...proposal,
      products: updatedProducts,
      updated_at: new Date().toISOString(),
    };

    try {
      const stored = localStorage.getItem('proposals');
      if (stored) {
        const proposals = JSON.parse(stored);
        const index = proposals.findIndex((p: Proposal) => p.id === params.id);
        if (index !== -1) {
          proposals[index] = updatedProposal;
          localStorage.setItem('proposals', JSON.stringify(proposals));
          setProposal(updatedProposal);
        }
      }
    } catch (error) {
      console.error('Error updating product field:', error);
    }
  };

  // Helper function to strip base64 images before saving to localStorage
  const stripBase64Images = (proposal: Proposal): Proposal => {
    return {
      ...proposal,
      products: proposal.products.map(product => ({
        ...product,
        aiEnrichment: product.aiEnrichment ? {
          ...product.aiEnrichment,
          design_alternatives: product.aiEnrichment.design_alternatives.map(alt => ({
            ...alt,
            generated_image_url: undefined // Remove base64 images to save space
          }))
        } : undefined
      }))
    };
  };

  const handleAIEnrich = async (productId: string) => {
    if (!proposal) return;

    const product = proposal.products.find(p => p.id === productId);
    if (!product || !product.image_urls || product.image_urls.length === 0) {
      alert('No product image available for AI enrichment');
      return;
    }

    setLoadingAIEnrich(productId);

    try {
      const userRemarks = aiEnrichRemarks[productId] || '';
      
      const response = await fetch('/api/ai-enrich', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl: product.image_urls[0],
          userNotes: userRemarks,
        }),
      });

      if (!response.ok) {
        throw new Error('AI enrichment failed');
      }

      const enrichmentData = await response.json();

      // Update product with AI enrichment data
      const updatedProducts = proposal.products.map(p => 
        p.id === productId 
          ? { 
              ...p, 
              aiEnrichment: {
                ...enrichmentData,
                enriched_at: new Date().toISOString(),
              }
            } 
          : p
      );

      const updatedProposal = {
        ...proposal,
        products: updatedProducts,
        updated_at: new Date().toISOString(),
      };

      // Save to localStorage (without base64 images to prevent quota errors)
      const stored = localStorage.getItem('proposals');
      if (stored) {
        const proposals = JSON.parse(stored);
        const index = proposals.findIndex((p: Proposal) => p.id === params.id);
        if (index !== -1) {
          proposals[index] = stripBase64Images(updatedProposal);
          localStorage.setItem('proposals', JSON.stringify(proposals));
          // Keep full data in state (with images)
          setProposal(updatedProposal);
        }
      }
      
      // Clear remarks after successful enrichment
      setAiEnrichRemarksOpen(null);
      setAiEnrichRemarks(prev => {
        const updated = { ...prev };
        delete updated[productId];
        return updated;
      });
    } catch (error) {
      console.error('Error enriching product:', error);
      alert('Failed to enrich product with AI. Please try again.');
    } finally {
      setLoadingAIEnrich(null);
    }
  };

  const removeProduct = (productId: string) => {
    if (!proposal) return;

    const updatedProducts = proposal.products.filter(p => p.id !== productId);
    const updatedProposal = {
      ...proposal,
      products: updatedProducts,
      totalItems: updatedProducts.length,
      totalValue: updatedProducts.reduce((sum, p) => sum + p.price.current, 0),
      updated_at: new Date().toISOString(),
    };

    try {
      const stored = localStorage.getItem('proposals');
      if (stored) {
        const proposals = JSON.parse(stored);
        const index = proposals.findIndex((p: Proposal) => p.id === params.id);
        if (index !== -1) {
          proposals[index] = updatedProposal;
          localStorage.setItem('proposals', JSON.stringify(proposals));
          setProposal(updatedProposal);
        }
      }
    } catch (error) {
      console.error('Error updating proposal:', error);
      alert('Failed to remove product');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4 pt-24">
          <div className="text-center py-20">
            <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-sky-500 border-r-transparent"></div>
            <p className="mt-4 text-gray-600">Loading proposal...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4 pt-24">
          <Card className="bg-white border-gray-200">
            <CardContent className="p-12 text-center">
              <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Proposal not found
              </h3>
              <p className="text-gray-600 mb-6">
                The proposal you're looking for doesn't exist.
              </p>
              <Button onClick={() => router.push('/proposals')} className="bg-sky-500 hover:bg-sky-600 text-white">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Proposals
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const totalValue = proposal.products.reduce((sum, p) => sum + p.price.current, 0);

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4 pt-24">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="outline"
            onClick={() => router.push('/proposals')}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Proposals
          </Button>
        </div>

        {/* Proposal Info Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex-1">
              {isEditing ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Proposal Name *
                    </label>
                    <Input
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      placeholder="e.g., Q1 2026 Product Sourcing"
                      className="max-w-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Client Name
                    </label>
                    <Input
                      value={editedClientName}
                      onChange={(e) => setEditedClientName(e.target.value)}
                      placeholder="e.g., ABC Company"
                      className="max-w-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Status
                    </label>
                    <Select value={editedStatus} onValueChange={setEditedStatus}>
                      <SelectTrigger className="max-w-md">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="submitted">Submitted</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-2xl font-bold text-gray-900">{proposal.name}</h1>
                    <Badge className={getStatusColor(proposal.status)}>
                      {proposal.status}
                    </Badge>
                  </div>
                  {proposal.client_name && (
                    <p className="text-gray-600">Client: {proposal.client_name}</p>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    className="bg-sky-500 hover:bg-sky-600 text-white"
                  >
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-sky-300 text-sky-600 hover:bg-sky-50"
                        disabled={isExportingPPTX}
                      >
                        {isExportingPPTX ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            Exporting...
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-1" />
                            Export
                          </>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={handleExportPDF}>
                        <FileText className="h-4 w-4 mr-2" />
                        Export as PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExportPPTX('default')}>
                        <FileText className="h-4 w-4 mr-2" />
                        Export PPTX (Default Template)
                      </DropdownMenuItem>
                      {templateManager.getTemplates().map((template) => (
                        <DropdownMenuItem
                          key={template.id}
                          onClick={() => handleExportPPTX(template.id)}
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          Export PPTX ({template.name})
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuItem
                        onClick={() => setIsTemplateDialogOpen(true)}
                        className="border-t mt-1 pt-2"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Manage Templates
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-600 hover:bg-red-50"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>
              <p className="text-sm text-gray-600 mb-1">Created</p>
              <div className="flex items-center text-gray-900">
                <Calendar className="h-4 w-4 mr-2" />
                {new Date(proposal.created_at).toLocaleDateString()}
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Currency</p>
              <div className="flex items-center text-gray-900">
                <DollarSign className="h-4 w-4 mr-2" />
                {proposal.currency}
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Items</p>
              <p className="text-lg font-semibold text-gray-900">{proposal.products.length}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Value</p>
              <p className="text-lg font-semibold text-sky-600">
                {formatCurrency(totalValue, proposal.currency)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Details Status</p>
              {(() => {
                const productsWithDetails = proposal.products.filter(p => p.cachedDetails);
                const allHaveDetails = productsWithDetails.length === proposal.products.length;
                return allHaveDetails ? (
                  <div className="flex items-center text-green-600">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    <span className="text-sm font-medium">All loaded</span>
                  </div>
                ) : productsWithDetails.length > 0 ? (
                  <div className="flex items-center text-amber-600">
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    <span className="text-sm font-medium">{productsWithDetails.length}/{proposal.products.length} loaded</span>
                  </div>
                ) : (
                  <div className="flex items-center text-gray-500">
                    <Loader2 className="h-4 w-4 mr-2" />
                    <span className="text-sm font-medium">None loaded</span>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="border-t pt-4">
            {isEditing ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <Textarea
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  placeholder="Add any notes or special requirements..."
                  rows={3}
                  className="w-full"
                />
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-2">Notes</p>
                <p className="text-gray-900">{proposal.notes || 'No notes added'}</p>
              </>
            )}
          </div>
        </div>

        {/* Products List */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b bg-gray-50">
            <h2 className="font-semibold text-gray-900">Products ({proposal.products.length})</h2>
          </div>

          {proposal.products.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <p>No products in this proposal</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {proposal.products.map((product) => {
                const isExpanded = expandedRows.has(product.id);
                const isLoadingDetails = loadingDetails.has(product.id);
                const details = productDetails.get(product.id);

                return (
                  <div key={product.id}>
                    <div className="p-6 hover:bg-gray-50 transition-colors">
                      <div className="flex gap-6">
                        <div className="flex-shrink-0">
                          <button
                            onClick={() => toggleRowExpansion(product.id, product)}
                            className="text-gray-400 hover:text-gray-600 transition-colors mb-2"
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-5 w-5" />
                            ) : (
                              <ChevronDown className="h-5 w-5" />
                            )}
                          </button>
                        </div>
                        <div className="flex-shrink-0">
                          <button
                            onClick={() => openImageCarousel(
                              product.image_urls.map(url => ({ url })),
                              0
                            )}
                            className="w-32 h-32 bg-gray-100 rounded-lg overflow-hidden hover:ring-2 hover:ring-sky-500 transition-all cursor-pointer"
                          >
                            {product.image_urls[0] ? (
                              <img
                                src={product.image_urls[0]}
                                alt={product.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400">
                                No image
                              </div>
                            )}
                          </button>
                        </div>

                        <div className="flex-1">
                          <div className="flex items-start gap-2 mb-2">
                            <h3 className="font-semibold text-gray-900 flex-1">{product.title}</h3>
                            {details && (
                              <button
                                onClick={() => setMetadataPopupOpen(metadataPopupOpen === product.id ? null : product.id)}
                                className="flex-shrink-0 p-1 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"
                                title="View metadata"
                              >
                                <Info className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          
                          {/* Metadata Popup */}
                          {metadataPopupOpen === product.id && details && (
                            <div className="mb-4 p-4 bg-white border border-gray-300 rounded-lg shadow-lg relative">
                              <button
                                onClick={() => setMetadataPopupOpen(null)}
                                className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
                              >
                                ✕
                              </button>
                              <h4 className="font-semibold text-gray-900 mb-3 text-sm">Original Product Metadata</h4>
                              <div className="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                  <h5 className="font-medium text-gray-700 mb-2">Product Information</h5>
                                  <dl className="space-y-1">
                                    <div className="flex justify-between">
                                      <dt className="text-gray-600">Brand:</dt>
                                      <dd className="font-medium text-gray-900">{details.brand || 'N/A'}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                      <dt className="text-gray-600">MOQ:</dt>
                                      <dd className="font-medium text-gray-900">{details.moq || 'N/A'}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                      <dt className="text-gray-600">Category ID:</dt>
                                      <dd className="font-medium text-gray-900">{details.category_id || 'N/A'}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                      <dt className="text-gray-600">Created:</dt>
                                      <dd className="font-medium text-gray-900">{details.created_time || 'N/A'}</dd>
                                    </div>
                                  </dl>
                                </div>
                                <div>
                                  <h5 className="font-medium text-gray-700 mb-2">Engagement Metrics</h5>
                                  <dl className="space-y-1">
                                    <div className="flex justify-between">
                                      <dt className="text-gray-600">Favorites:</dt>
                                      <dd className="font-medium text-gray-900">
                                        {details.fav_count !== undefined && details.fav_count !== null ? details.fav_count : 'N/A'}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between">
                                      <dt className="text-gray-600">Fans:</dt>
                                      <dd className="font-medium text-gray-900">
                                        {details.fans_count !== undefined && details.fans_count !== null ? details.fans_count : 'N/A'}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between">
                                      <dt className="text-gray-600">Rating:</dt>
                                      <dd className="font-medium text-gray-900">{details.rating_grade || 'N/A'}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                      <dt className="text-gray-600">Sales:</dt>
                                      <dd className="font-medium text-gray-900">
                                        {details.sales_volume ? `${details.sales_volume.toLocaleString()}` : 'N/A'}
                                      </dd>
                                    </div>
                                  </dl>
                                </div>
                              </div>
                              {details.props && details.props.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-200">
                                  <h5 className="font-medium text-gray-700 mb-2 text-xs">Specifications</h5>
                                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                    {details.props.slice(0, 6).map((prop, idx) => (
                                      <div key={idx} className="flex justify-between">
                                        <dt className="text-gray-600 truncate">{prop.name}:</dt>
                                        <dd className="font-medium text-gray-900 truncate">{prop.value}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                </div>
                              )}
                            </div>
                          )}
                      
                      <div className="space-y-2">
                        {/* Secondary Images on left, Product info on right */}
                        <div className="flex gap-4">
                          {/* OneBound Product Images - Left side */}
                          {details?.item_imgs && details.item_imgs.length > 0 && (
                            <div className="flex gap-2 overflow-x-auto">
                              {details.item_imgs.slice(0, 6).map((img, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => openImageCarousel(details.item_imgs || [], idx)}
                                  className="w-16 h-16 bg-gray-100 rounded overflow-hidden hover:ring-2 hover:ring-sky-500 transition-all cursor-pointer flex-shrink-0"
                                >
                                  <img 
                                    src={img.url.startsWith('//') ? `https:${img.url}` : img.url}
                                    alt={`Product ${idx + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                          
                          {/* Product Info - Right side */}
                          <div className="space-y-2 text-sm flex-1">
                            <div>
                              <span className="text-gray-600">Price:</span>
                              <span className="ml-2 font-semibold text-sky-600">
                                {formatCurrency(product.price.current, product.price.currency)}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600">Platform:</span>
                              <span className="ml-2 capitalize">{product.source}</span>
                            </div>
                            {product.moq && (
                              <div>
                                <span className="text-gray-600">MOQ:</span>
                                <span className="ml-2">{product.moq} units</span>
                              </div>
                            )}
                            {product.seller?.location && (
                              <div>
                                <span className="text-gray-600">Location:</span>
                                <span className="ml-2">{product.seller.location}</span>
                              </div>
                            )}
                            <a
                              href={product.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-sky-600 hover:text-sky-700 inline-block"
                            >
                              View on {product.source}
                            </a>
                          </div>
                        </div>
                        
                        {/* AI Enrichment Context - Pill-shaped textbox below */}
                        <div className="flex items-center gap-2">
                          <Textarea
                            value={aiEnrichRemarks[product.id] || ''}
                            onChange={(e) => setAiEnrichRemarks(prev => ({
                              ...prev,
                              [product.id]: e.target.value
                            }))}
                            placeholder="Guide AI designs (e.g., eco-friendly, modern)"
                            rows={1}
                            className="flex-1 text-xs bg-white border border-purple-200 rounded-full px-4 py-1 h-7 focus:ring-2 focus:ring-purple-300 focus:border-transparent transition-all placeholder:text-gray-400 resize-none leading-tight"
                          />
                          <Button
                            size="sm"
                            onClick={() => handleAIEnrich(product.id)}
                            disabled={loadingAIEnrich === product.id}
                            className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white shadow-sm hover:shadow transition-all h-9 w-9 p-0 rounded-full flex-shrink-0"
                            title="Generate AI Designs"
                          >
                            {loadingAIEnrich === product.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                            )}
                          </Button>
                        </div>
                      </div>
                        </div>

                        <div className="flex-shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeProduct(product.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details - Combined View */}
                    {isExpanded && (
                      <div className="px-6 pb-6 bg-gray-50">
                        {isLoadingDetails ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-sky-500 mr-2" />
                            <span className="text-gray-600">Loading product details...</span>
                          </div>
                        ) : (
                          <div className="space-y-6 mt-6">
                            {/* AI Enrichment Section */}
                              {product.aiEnrichment && (
                                <>
                                  <div className="flex items-center gap-2 mb-4">
                                    <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    <h4 className="font-semibold text-gray-900">AI Design Alternatives</h4>
                                    <Badge variant="outline" className="text-purple-600 border-purple-600">
                                      Generated {new Date(product.aiEnrichment.enriched_at).toLocaleDateString()}
                                    </Badge>
                                  </div>

                                  {/* Original Product Analysis */}
                                  <div className="bg-white rounded-lg p-4 mb-4">
                                    <h5 className="font-medium text-gray-900 mb-3">Original Product</h5>
                                    <p className="text-sm font-semibold text-gray-800 mb-1">
                                      {product.aiEnrichment.original_product.title}
                                    </p>
                                    <p className="text-sm text-gray-600 mb-4">
                                      {product.aiEnrichment.original_product.description}
                                    </p>

                                    {/* Product Specifications */}
                                    {product.aiEnrichment.original_product.specifications && (
                                      <div className="border-t border-gray-200 pt-3 mt-3">
                                        <h6 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Product Specifications</h6>
                                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                          {product.aiEnrichment.original_product.specifications.dimensions !== 'N/A' && (
                                            <>
                                              <dt className="text-gray-600">Dimensions:</dt>
                                              <dd className="font-medium text-gray-900">{product.aiEnrichment.original_product.specifications.dimensions}</dd>
                                            </>
                                          )}
                                          {product.aiEnrichment.original_product.specifications.weight !== 'N/A' && (
                                            <>
                                              <dt className="text-gray-600">Weight:</dt>
                                              <dd className="font-medium text-gray-900">{product.aiEnrichment.original_product.specifications.weight}</dd>
                                            </>
                                          )}
                                          {product.aiEnrichment.original_product.specifications.materials !== 'N/A' && (
                                            <>
                                              <dt className="text-gray-600">Materials:</dt>
                                              <dd className="font-medium text-gray-900">{product.aiEnrichment.original_product.specifications.materials}</dd>
                                            </>
                                          )}
                                          {product.aiEnrichment.original_product.specifications.other_specs !== 'N/A' && (
                                            <>
                                              <dt className="text-gray-600">Other:</dt>
                                              <dd className="font-medium text-gray-900">{product.aiEnrichment.original_product.specifications.other_specs}</dd>
                                            </>
                                          )}
                                        </dl>
                                      </div>
                                    )}
                                  </div>

                                  {/* Design Alternatives */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {product.aiEnrichment.design_alternatives.map((alt, idx) => (
                                      <div key={idx} className="bg-white rounded-lg border border-gray-200 hover:border-purple-300 transition-colors overflow-hidden">
                                        <div className="flex items-start gap-2 p-3 bg-gray-50 border-b border-gray-200">
                                          <Badge variant="secondary" className="text-xs">
                                            Concept {idx + 1}
                                          </Badge>
                                          <h6 className="font-semibold text-gray-900 flex-1">{alt.concept_title}</h6>
                                        </div>
                                        
                                        {/* Concept Image Visualization */}
                                        <div className="relative bg-gradient-to-br from-purple-50 to-sky-50 aspect-square">
                                          {alt.generated_image_url ? (
                                            <img 
                                              src={alt.generated_image_url} 
                                              alt={alt.concept_title}
                                              className="w-full h-full object-cover"
                                            />
                                          ) : (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                                              <svg className="h-12 w-12 text-purple-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                              </svg>
                                              <p className="text-xs text-gray-600 italic leading-relaxed">
                                                {alt.generated_image_prompt}
                                              </p>
                                            </div>
                                          )}
                                        </div>

                                        <div className="p-4 space-y-3">
                                          <p className="text-sm text-gray-700">{alt.short_description}</p>
                                          
                                          <div className="border-t border-gray-100 pt-3">
                                            <p className="text-xs font-medium text-gray-500 mb-1">Design Rationale:</p>
                                            <p className="text-xs text-gray-700 leading-relaxed">{alt.design_rationale}</p>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ImageCarouselModal
        images={carouselImages}
        initialIndex={carouselInitialIndex}
        isOpen={isCarouselOpen}
        onClose={() => setIsCarouselOpen(false)}
      />
      
      <TemplateManagerDialog
        open={isTemplateDialogOpen}
        onOpenChange={setIsTemplateDialogOpen}
      />
    </div>
  );
}

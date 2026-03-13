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
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ type: 'pdf' | 'pptx' | null; message: string }>({ type: null, message: '' });
  const [metadataPopupOpen, setMetadataPopupOpen] = useState<string | null>(null);
  const [aiEnrichRemarksOpen, setAiEnrichRemarksOpen] = useState<string | null>(null);
  const [aiEnrichRemarks, setAiEnrichRemarks] = useState<Record<string, string>>({});
  const [selectedSecondaryImages, setSelectedSecondaryImages] = useState<Record<string, string[]>>({});

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

    setIsExportingPDF(true);
    setExportProgress({ type: 'pdf', message: 'Generating PDF...' });

    try {
      // Add selected secondary images to each product
      const proposalWithSelectedImages = {
        ...proposal,
        products: proposal.products.map(product => ({
          ...product,
          selectedSecondaryImages: selectedSecondaryImages[product.id] || []
        }))
      };

      const response = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          proposal: proposalWithSelectedImages,
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
    } finally {
      setIsExportingPDF(false);
      setExportProgress({ type: null, message: '' });
    }
  };

  const handleExportPPTX = async (templateId?: string) => {
    if (!proposal) return;

    setIsExportingPPTX(true);
    setExportProgress({ type: 'pptx', message: 'Generating PowerPoint...' });
    try {
      // Add selected secondary images to each product
      const proposalWithSelectedImages = {
        ...proposal,
        products: proposal.products.map(product => ({
          ...product,
          selectedSecondaryImages: selectedSecondaryImages[product.id] || []
        }))
      };

      const response = await fetch('/api/export/pptx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          proposal: proposalWithSelectedImages,
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
      setExportProgress({ type: null, message: '' });
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

  const toggleSecondaryImageSelection = (productId: string, imageUrl: string) => {
    const currentSelection = selectedSecondaryImages[productId] || [];
    const newSelection = currentSelection.includes(imageUrl)
      ? currentSelection.filter(url => url !== imageUrl)
      : [...currentSelection, imageUrl].slice(0, 3); // Max 3 images
    
    setSelectedSecondaryImages(prev => ({
      ...prev,
      [productId]: newSelection
    }));
  };

  // Load product details automatically
  useEffect(() => {
    if (proposal) {
      console.log('Loading product details for', proposal.products.length, 'products');
      
      const loadAllDetails = async () => {
        const detailsPromises = proposal.products.map(async (product) => {
          if (productDetails.has(product.id)) {
            console.log(`Details already loaded for product ${product.id}`);
            return null;
          }
          
          console.log(`Loading details for product ${product.id}`);
          
          // Check if product has cached details with secondary images
          const hasCachedDetails = product.cachedDetails && 
            product.cachedDetails.item_imgs && 
            product.cachedDetails.item_imgs.length > 0;
          
          if (hasCachedDetails) {
            console.log(`Using cached details for ${product.id} (${product.cachedDetails?.item_imgs?.length} images)`);
            return { id: product.id, details: product.cachedDetails };
          }

          // Fetch from web if no cached details or no secondary images
          console.log(`Fetching from web for ${product.id} (no cached details or no images)`);
          try {
            const response = await fetch(`/api/product-details?productId=${product.id}&platform=${product.source}`);
            
            if (!response.ok) {
              console.error(`Failed to fetch details for ${product.id}:`, response.status);
              return null;
            }

            const details = await response.json();
            console.log(`Successfully loaded details from web for ${product.id}:`, details);
            return { id: product.id, details };
          } catch (error) {
            console.error(`Error fetching product details for ${product.id}:`, error);
            return null;
          }
        });
        
        // Wait for all promises to complete
        const results = await Promise.all(detailsPromises);
        
        // Batch update state with all loaded details
        const newDetails = new Map(productDetails);
        let hasNewDetails = false;
        
        results.forEach(result => {
          if (result) {
            newDetails.set(result.id, result.details);
            hasNewDetails = true;
          }
        });
        
        if (hasNewDetails) {
          setProductDetails(newDetails);
        }
      };
      
      loadAllDetails();
    }
  }, [proposal?.products]);

  const toggleRowExpansion = async (productId: string, product: ProductDTO) => {
    // Disabled - details are now shown directly
    console.log(`Expand functionality disabled for ${productId}`);
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
            className="mb-4 rounded-full"
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
                        className="border-sky-300 text-sky-600 hover:bg-sky-50 rounded-full h-9 w-9 p-0"
                        disabled={isExportingPPTX}
                        title="Export"
                      >
                        {isExportingPPTX ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
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
                    className="rounded-full h-9 w-9 p-0"
                    title="Edit"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-600 hover:bg-red-50 rounded-full h-9 w-9 p-0"
                    onClick={handleDelete}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
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
                const details = productDetails.get(product.id);

                return (
                  <div key={product.id}>
                    <div className="p-6 hover:bg-gray-50 transition-colors">
                      <div className="flex gap-6">
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
                          
                          {/* Secondary Images with Checkboxes */}
                          <div className="space-y-2">
                            <h5 className="text-sm font-medium text-gray-700 mb-2">Select up to 3 secondary photos for export:</h5>
                            {details?.item_imgs && details.item_imgs.length > 0 && (
                              <div className="flex gap-2 overflow-x-auto">
                                {details.item_imgs.slice(0, 6).map((img, idx) => {
                                  const imageUrl = img.url.startsWith('//') ? `https:${img.url}` : img.url;
                                  const isSelected = selectedSecondaryImages[product.id]?.includes(imageUrl) || false;
                                  
                                  return (
                                    <div key={idx} className="relative">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleSecondaryImageSelection(product.id, imageUrl)}
                                        className="absolute top-1 left-1 w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                                        id={`secondary-img-${product.id}-${idx}`}
                                      />
                                      <button
                                        onClick={() => openImageCarousel(details.item_imgs || [], idx)}
                                        className={`w-16 h-16 rounded overflow-hidden hover:ring-2 hover:ring-sky-500 transition-all cursor-pointer flex-shrink-0 ${
                                          isSelected ? 'ring-2 ring-purple-500 border-2 border-purple-500' : 'border-2 border-gray-300'
                                        }`}
                                      >
                                        <img 
                                          src={imageUrl}
                                          alt={`Product ${idx + 1}`}
                                          className="w-full h-full object-cover"
                                        />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          
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
                          <Input
                            value={aiEnrichRemarks[product.id] || ''}
                            onChange={(e) => setAiEnrichRemarks(prev => ({
                              ...prev,
                              [product.id]: e.target.value
                            }))}
                            placeholder="Guide AI designs (e.g., eco-friendly, modern)"
                            className="flex-1 text-xs bg-white border border-purple-200 rounded-full px-4 h-9 focus:ring-2 focus:ring-purple-300 focus:border-transparent transition-all placeholder:text-gray-400"
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
                );
              })};
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

      {/* Export Progress Overlay */}
      {(isExportingPDF || isExportingPPTX) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-8 shadow-2xl flex flex-col items-center gap-4 max-w-sm mx-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full border-4 border-sky-100 border-t-sky-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                {exportProgress.type === 'pdf' ? (
                  <FileText className="h-6 w-6 text-sky-500" />
                ) : (
                  <Download className="h-6 w-6 text-sky-500" />
                )}
              </div>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-gray-900 mb-1">
                {exportProgress.message}
              </p>
              <p className="text-sm text-gray-500">
                Please wait, this may take a moment...
              </p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mt-2 overflow-hidden">
              <div className="bg-sky-500 h-2 rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Calendar, DollarSign, Trash2, Edit, Download, FileText, ChevronDown, ChevronUp, Loader2, Upload, CheckCircle2, Package, Info, RefreshCw, GripVertical } from "lucide-react";
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
  createdBy?: { email: string; name: string } | null;
}

interface ProductDetails {
  title?: string;
  desc?: string;
  desc_short?: string;
  sku?: string;
  num?: string;
  shop_name?: string;
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
  cached?: boolean;
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
  const [selectedAIImages, setSelectedAIImages] = useState<Record<string, string[]>>({});

  // Proposal data from JSON storage
  const [proposalData, setProposalData] = useState<any>(null);
  const [isLoadingProposalData, setIsLoadingProposalData] = useState(false);
  
  // Expanded product details for full text display
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());

  // Drag-and-drop reorder state
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  // Load proposal data from server-side JSON storage
  const loadProposalDataFromStorage = useCallback(async () => {
    if (!proposal) return;
    
    setIsLoadingProposalData(true);
    console.log('Loading proposal data from JSON storage...');
    
    try {
      const response = await fetch(`/api/proposal-details?proposalId=${proposal.id}`);
      
      if (response.ok) {
        const data = await response.json();
        setProposalData(data);
        console.log('Loaded proposal data:', data);
        
        // Load item details from storage into productDetails map
        const newDetails = new Map<string, ProductDetails>();
        const newSelectedImages: Record<string, string[]> = {};
        const newSelectedAIImages: Record<string, string[]> = {};
        
        Object.entries(data.itemDetails || {}).forEach(([key, details]: [string, any]) => {
          // Use the key directly as productId (it's the source_id / num_iid)
          const productId = details.productId || key;
          newDetails.set(productId, details);
          
          const product = proposal.products.find(p => p.source_id === productId);
          if (product) {
            // Load saved secondary image selections
            if (details.selectedSecondaryImages && details.selectedSecondaryImages.length > 0) {
              newSelectedImages[product.id] = details.selectedSecondaryImages;
            } else if (details.item_imgs && details.item_imgs.length > 0) {
              // Auto-select first 4 secondary images from item_imgs
              const imageUrls = details.item_imgs.slice(0, 4).map((img: any) => {
                const url = typeof img === 'string' ? img : img.url;
                return url.startsWith('//') ? `https:${url}` : url;
              });
              newSelectedImages[product.id] = imageUrls;
            }
            // Load saved AI image selections
            if (details.selectedAIImages && details.selectedAIImages.length > 0) {
              newSelectedAIImages[product.id] = details.selectedAIImages;
            }
          }
        });
        
        setProductDetails(newDetails);
        setSelectedSecondaryImages(newSelectedImages);
        if (Object.keys(newSelectedAIImages).length > 0) {
          setSelectedAIImages(newSelectedAIImages);
        }

        // Apply aiEnrichments from server JSON back into products
        if (data.aiEnrichments && Object.keys(data.aiEnrichments).length > 0) {
          setProposal(prev => {
            if (!prev) return prev;
            const updatedProducts = prev.products.map(p => {
              const enrichment = data.aiEnrichments[p.source_id];
              if (enrichment && !p.aiEnrichment) {
                return { ...p, aiEnrichment: enrichment };
              }
              return p;
            });
            return { ...prev, products: updatedProducts };
          });
        }

        console.log(`Loaded ${newDetails.size} product details from storage`);
      } else if (response.status === 404) {
        // No storage file yet - this is normal for older proposals
        console.log('No proposal data file found - will create when saving');
      } else {
        console.error('Failed to load proposal data:', await response.text());
      }
    } catch (error) {
      console.error('Error loading proposal data:', error);
    } finally {
      setIsLoadingProposalData(false);
    }
  }, [proposal]);

  // Fetch a single product detail on demand (for expand functionality)
  const fetchProductDetailOnDemand = async (productId: string) => {
    if (!proposal) return;
    
    const product = proposal.products.find(p => p.source_id === productId || p.id === productId);
    if (!product) return;
    
    setLoadingDetails(prev => new Set(prev).add(productId));
    
    try {
      // Try to fetch from storage with fetch=true to trigger API call if not cached
      const response = await fetch(`/api/proposal-details?proposalId=${proposal.id}&productId=${productId}&fetch=true`);
      
      if (response.ok) {
        const details = await response.json();
        
        // Update productDetails map
        setProductDetails(prev => new Map(prev).set(productId, details));
        
        // Update proposalData
        setProposalData((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            itemDetails: {
              ...prev.itemDetails,
              [`${proposal.id}_${productId}`]: details
            }
          };
        });
        
        // Auto-select first 4 secondary images if not already selected
        if (details.item_imgs && !selectedSecondaryImages[product.id]) {
          const imageUrls = details.item_imgs.slice(0, 4).map((img: { url: string }) => {
            const url = img.url.startsWith('//') ? `https:${img.url}` : img.url;
            return url;
          });
          
          setSelectedSecondaryImages(prev => ({
            ...prev,
            [product.id]: imageUrls
          }));
          
          // Save to server
          await saveSecondaryImageSelection(productId, imageUrls);
        }
        
        console.log(`Fetched details for ${productId}`);
      } else {
        console.error(`Failed to fetch details for ${productId}:`, await response.text());
      }
    } catch (error) {
      console.error(`Error fetching details for ${productId}:`, error);
    } finally {
      setLoadingDetails(prev => {
        const newSet = new Set(prev);
        newSet.delete(productId);
        return newSet;
      });
    }
  };

  // Save secondary image selection to JSON file
  const saveSecondaryImageSelection = async (productId: string, images: string[]) => {
    if (!proposal) return;
    
    try {
      const response = await fetch('/api/proposal-details', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          productId,
          selectedSecondaryImages: images
        })
      });
      
      if (!response.ok) {
        console.error('Failed to save secondary image selection:', await response.text());
      }
    } catch (error) {
      console.error('Error saving secondary image selection:', error);
    }
  };

  // Toggle expand for full text item details
  const toggleDetailExpansion = (productId: string) => {
    setExpandedDetails(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  // Sequential fetch all remaining product details (for force reload)
  const fetchAllProductDetailsSequential = async () => {
    if (!proposal || !proposalData) return;
    
    const productsToFetch = proposal.products.filter(p => {
      const key = `${proposal.id}_${p.source_id}`;
      return !proposalData.itemDetails?.[key];
    });
    
    if (productsToFetch.length === 0) {
      console.log('All product details already loaded');
      return;
    }
    
    console.log(`Fetching details for ${productsToFetch.length} remaining products...`);
    
    for (let i = 0; i < productsToFetch.length; i++) {
      const product = productsToFetch[i];
      console.log(`[${i + 1}/${productsToFetch.length}] Fetching ${product.source_id}...`);
      
      await fetchProductDetailOnDemand(product.source_id);
    }
    
    console.log('Finished fetching all product details');
  };

  useEffect(() => {
    loadProposal();
  }, [params.id]);

  // Fetch details for all products on load
  useEffect(() => {
    if (proposal && proposal.products.length > 0) {
      loadProposalDataFromStorage();
    }
  }, [proposal?.id]);

  const loadProposal = async () => {
    try {
      // Always fetch from server first — server JSON is the source of truth
      const response = await fetch(`/api/proposal-details?proposalId=${params.id}`);
      if (response.ok) {
        const data = await response.json();

        // Merge aiEnrichments into products
        const products = (data.products || []).map((p: any) => {
          const enrichment = data.aiEnrichments?.[p.source_id];
          return enrichment ? { ...p, aiEnrichment: enrichment } : p;
        });

        const serverProposal: Proposal = {
          id: data.proposalId,
          name: data.proposalName || 'Untitled',
          client_name: data.clientName || '',
          notes: data.notes || '',
          status: data.status || 'draft',
          currency: 'CNY',
          created_at: data.createdAt,
          updated_at: data.updatedAt,
          products,
          totalItems: data.products?.length || 0,
          totalValue: data.products?.reduce((sum: number, p: any) => sum + (p.price?.current || 0), 0) || 0,
          createdBy: data.createdBy,
        };

        setProposal(serverProposal);
        setEditedName(serverProposal.name);
        setEditedClientName(serverProposal.client_name || '');
        setEditedNotes(serverProposal.notes || '');
        setEditedStatus(serverProposal.status);

        // Update localStorage to keep it in sync with server
        try {
          const existing = JSON.parse(localStorage.getItem('proposals') || '[]');
          const idx = existing.findIndex((p: any) => p.id === serverProposal.id);
          const stripped = stripBase64Images(serverProposal);
          if (idx >= 0) {
            existing[idx] = stripped;
          } else {
            existing.unshift(stripped);
          }
          localStorage.setItem('proposals', JSON.stringify(existing));
        } catch (e) { /* ignore storage errors */ }
        return;
      }

      // Fallback: load from localStorage if server returns 404 or error
      console.log('Server fetch failed, falling back to localStorage...');
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
          return;
        }
      }
      setProposal(null);
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
      // Add selected secondary images and cached details to each product
      const proposalWithDetails = {
        ...proposal,
        products: proposal.products.map(product => {
          const details = productDetails.get(product.source_id);
          return {
            ...product,
            selectedSecondaryImages: selectedSecondaryImages[product.id] || [],
            selectedAIImages: selectedAIImages[product.id] || [],
            // Include cached details if available
            cachedDetails: details ? {
              desc: details.desc,
              props: details.props,
              sku: details.sku,
              num: details.num,
              shop_name: details.shop_name,
              item_imgs: details.item_imgs,
            } : undefined
          };
        })
      };

      const response = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          proposal: proposalWithDetails,
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
      // Add selected secondary images and cached details to each product
      const proposalWithDetails = {
        ...proposal,
        products: proposal.products.map(product => {
          const details = productDetails.get(product.source_id);
          return {
            ...product,
            selectedSecondaryImages: selectedSecondaryImages[product.id] || [],
            selectedAIImages: selectedAIImages[product.id] || [],
            // Include cached details if available
            cachedDetails: details ? {
              desc: details.desc,
              props: details.props,
              sku: details.sku,
              num: details.num,
              shop_name: details.shop_name,
              item_imgs: details.item_imgs,
            } : undefined
          };
        })
      };

      const response = await fetch('/api/export/pptx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          proposal: proposalWithDetails,
          orientation: 'landscape',
          templateId: templateId || 'default',
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || `Server error ${response.status}`);
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

  const toggleSecondaryImageSelection = async (productId: string, imageUrl: string) => {
    const currentSelection = selectedSecondaryImages[productId] || [];
    const newSelection = currentSelection.includes(imageUrl)
      ? currentSelection.filter((url: string) => url !== imageUrl)
      : [...currentSelection, imageUrl].slice(0, 4); // Max 4 images
    
    setSelectedSecondaryImages(prev => ({
      ...prev,
      [productId]: newSelection
    }));
    
    // Find the product's source_id for saving to JSON
    const product = proposal?.products.find(p => p.id === productId);
    if (product) {
      await saveSecondaryImageSelection(product.source_id, newSelection);
    }
  };

  const toggleAIImageSelection = async (productId: string, imageUrl: string) => {
    const currentSelection = selectedAIImages[productId] || [];
    const newSelection = currentSelection.includes(imageUrl)
      ? currentSelection.filter((url: string) => url !== imageUrl)
      : [...currentSelection, imageUrl].slice(0, 4); // Max 4 images
    
    setSelectedAIImages(prev => ({
      ...prev,
      [productId]: newSelection
    }));

    // Auto-save to server JSON
    const product = proposal?.products.find(p => p.id === productId);
    if (product?.source_id) {
      try {
        await fetch('/api/proposal-details', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposalId: proposal!.id,
            allSelectedAIImages: { [product.source_id]: newSelection },
          }),
        });
      } catch (err) {
        console.error('Failed to save AI image selection:', err);
      }
    }
  };

  // Helper function to normalize item_imgs from various API formats
  const normalizeItemImgs = (itemImgs: any): Array<{ url: string }> => {
    if (!itemImgs) return [];
    
    // Already an array of objects with url
    if (Array.isArray(itemImgs) && itemImgs.length > 0 && typeof itemImgs[0] === 'object' && itemImgs[0].url) {
      return itemImgs;
    }
    
    // Array of strings (URLs)
    if (Array.isArray(itemImgs) && itemImgs.length > 0 && typeof itemImgs[0] === 'string') {
      return itemImgs.map((url: string) => ({ url }));
    }
    
    // Single string
    if (typeof itemImgs === 'string') {
      return [{ url: itemImgs }];
    }
    
    // Object with nested structure (some APIs wrap images differently)
    if (typeof itemImgs === 'object' && !Array.isArray(itemImgs)) {
      // Try to extract from common nested formats
      const possibleArrays = ['img', 'image', 'url', 'src', 'thumb'];
      for (const key of possibleArrays) {
        if (Array.isArray(itemImgs[key])) {
          return normalizeItemImgs(itemImgs[key]);
        }
      }
    }
    
    return [];
  };

  // Force reload all product details (fetch missing details sequentially)
  const forceReloadAllProductDetails = async () => {
    if (!proposal || !proposalData) return;
    
    await fetchAllProductDetailsSequential();
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

  // Helper function to strip base64 data: URLs before saving to localStorage (keep regular URLs)
  const saveProductOrder = async (orderedProducts: ProductDTO[]) => {
    if (!proposal) return;
    try {
      await fetch('/api/proposal-details', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          updatedProducts: orderedProducts.map(p => ({
            id: p.id, source_id: p.source_id, source: p.source,
            title: p.title, price: p.price, image_urls: p.image_urls,
            url: p.url, moq: p.moq, seller: p.seller,
          })),
        }),
      });
    } catch (err) {
      console.error('Failed to save product order:', err);
    }
  };

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const fromIndex = dragIndexRef.current;
    if (fromIndex === null || fromIndex === dropIndex || !proposal) return;
    const reordered = [...proposal.products];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    setProposal({ ...proposal, products: reordered });
    saveProductOrder(reordered);
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const stripBase64Images = (proposal: Proposal): Proposal => {
    return {
      ...proposal,
      products: proposal.products.map(product => ({
        ...product,
        aiEnrichment: product.aiEnrichment ? {
          ...product.aiEnrichment,
          design_alternatives: product.aiEnrichment.design_alternatives.map(alt => ({
            ...alt,
            // Only strip actual base64 data URLs, keep regular https:// URLs
            generated_image_url: alt.generated_image_url?.startsWith('data:') ? undefined : alt.generated_image_url
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
          proposalId: params.id,
          productId: product.source_id || product.id,
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

  const removeProduct = async (productId: string) => {
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
      // Auto-save product list to server JSON
      await fetch('/api/proposal-details', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          updatedProducts,
        }),
      });
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
                    onClick={forceReloadAllProductDetails}
                    className="border-sky-300 text-sky-600 hover:bg-sky-50 rounded-full h-9 w-9 p-0"
                    disabled={loadingDetails.size > 0}
                    title="Reload All Secondary Photos"
                  >
                    {loadingDetails.size > 0 ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                    className="rounded-full h-9 w-9 p-0"
                    title="Edit proposal details"
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
                const loadedCount = proposalData?.successfulItems || 0;
                const totalCount = proposal?.products.length || 0;
                const allHaveDetails = loadedCount === totalCount && totalCount > 0;
                return allHaveDetails ? (
                  <div className="flex items-center text-green-600">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    <span className="text-sm font-medium">All loaded</span>
                  </div>
                ) : loadedCount > 0 ? (
                  <div className="flex items-center text-amber-600">
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    <span className="text-sm font-medium">{loadedCount}/{totalCount} loaded</span>
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
              {proposal.products.map((product, index) => {
                const details = productDetails.get(product.source_id);

                return (
                  <div
                    key={product.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`transition-colors ${
                      dragOverIndex === index && dragIndexRef.current !== index
                        ? 'border-t-2 border-sky-400 bg-sky-50'
                        : ''
                    }`}
                  >
                    <div className="p-6 hover:bg-gray-50 transition-colors">
                      <div className="flex gap-6">
                        <div className="flex-shrink-0 flex items-center pr-1 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500">
                          <GripVertical className="h-5 w-5" />
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
                          
                          {/* Secondary Images with Checkboxes */}
                          <div className="space-y-2">
                            <h5 className="text-sm font-medium text-gray-700 mb-2">
                              Select up to 4 secondary photos for export:
                              {details?.item_imgs && (
                                <span className="ml-2 text-xs text-gray-500">
                                  ({details.item_imgs.length} available)
                                </span>
                              )}
                            </h5>
                            {!details?.item_imgs && (
                              <p className="text-xs text-gray-400">No secondary images data available</p>
                            )}
                            {details?.item_imgs && details.item_imgs.length === 0 && (
                              <p className="text-xs text-gray-400">Empty image list from API</p>
                            )}
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

                          {/* AI Generated Image Selection - directly under secondary images */}
                          {product.aiEnrichment?.design_alternatives && product.aiEnrichment.design_alternatives.some(a => a.generated_image_url) && (
                            <div className="mt-3 space-y-2">
                              <h5 className="text-sm font-medium text-purple-700">
                                Select AI designs for export (up to 4):
                                <span className="ml-2 text-xs text-gray-500">
                                  ({selectedAIImages[product.id]?.length || 0}/4 selected)
                                </span>
                              </h5>
                              <div className="flex gap-2 overflow-x-auto pb-1">
                                {product.aiEnrichment.design_alternatives.map((alt, idx) => {
                                  if (!alt.generated_image_url) return null;
                                  const isSelected = selectedAIImages[product.id]?.includes(alt.generated_image_url) || false;
                                  return (
                                    <div key={idx} className="relative flex-shrink-0">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleAIImageSelection(product.id, alt.generated_image_url!)}
                                        className="absolute top-1 left-1 w-4 h-4 text-purple-600 rounded focus:ring-purple-500 z-10"
                                      />
                                      <button
                                        onClick={() => openImageCarousel(
                                          product.aiEnrichment!.design_alternatives
                                            .filter(a => a.generated_image_url)
                                            .map(a => ({ url: a.generated_image_url! })),
                                          idx
                                        )}
                                        title={alt.concept_title}
                                        className={`w-16 h-16 rounded overflow-hidden hover:ring-2 hover:ring-purple-500 transition-all cursor-pointer ${
                                          isSelected ? 'ring-2 ring-purple-500 border-2 border-purple-500' : 'border-2 border-gray-300'
                                        }`}
                                      >
                                        <img
                                          src={alt.generated_image_url}
                                          alt={alt.concept_title}
                                          className="w-full h-full object-cover bg-purple-50"
                                          referrerPolicy="no-referrer"
                                          onError={(e) => {
                                            const t = e.currentTarget;
                                            t.style.display = 'none';
                                            const parent = t.parentElement;
                                            if (parent && !parent.querySelector('.img-fallback')) {
                                              const fb = document.createElement('div');
                                              fb.className = 'img-fallback w-full h-full flex items-center justify-center bg-purple-100 text-purple-500 text-xs text-center p-1';
                                              fb.textContent = alt.concept_title;
                                              parent.appendChild(fb);
                                            }
                                          }}
                                        />
                                      </button>
                                      <p className="text-xs text-gray-500 mt-1 text-center w-16 truncate">{alt.concept_title}</p>
                                    </div>
                                  );
                                })}
                              </div>
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
                            
                            {/* Expand/Collapse Button */}
                            <button
                              onClick={() => toggleDetailExpansion(product.source_id)}
                              className="flex items-center gap-1 text-sky-600 hover:text-sky-700 text-sm mt-2"
                            >
                              {expandedDetails.has(product.source_id) ? (
                                <>
                                  <ChevronUp className="h-4 w-4" />
                                  Hide Details
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-4 w-4" />
                                  Show Full Details
                                  {!details && loadingDetails.has(product.source_id) && (
                                    <Loader2 className="h-3 w-3 animate-spin ml-1" />
                                  )}
                                </>
                              )}
                            </button>
                            
                            {/* Expanded Full Details */}
                            {expandedDetails.has(product.source_id) && details && (
                              <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm">
                                {loadingDetails.has(product.source_id) ? (
                                  <div className="flex items-center gap-2 text-gray-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading details...
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {details.desc && (
                                      <div>
                                        <span className="font-medium text-gray-700">Description:</span>
                                        <p className="text-gray-600 mt-1 whitespace-pre-wrap">{details.desc}</p>
                                      </div>
                                    )}
                                    {details.props && details.props.length > 0 && (
                                      <div>
                                        <span className="font-medium text-gray-700">Properties:</span>
                                        <div className="mt-1 grid grid-cols-2 gap-1">
                                          {details.props.slice(0, 8).map((prop: { name: string; value: string }, idx: number) => (
                                            <div key={idx} className="text-xs text-gray-600">
                                              <span className="font-medium">{prop.name}:</span> {prop.value}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {details.sku && (
                                      <div>
                                        <span className="font-medium text-gray-700">SKU:</span>
                                        <span className="text-gray-600 ml-1">{details.sku}</span>
                                      </div>
                                    )}
                                    {details.num && (
                                      <div>
                                        <span className="font-medium text-gray-700">Item ID:</span>
                                        <span className="text-gray-600 ml-1">{details.num}</span>
                                      </div>
                                    )}
                                    {details.shop_name && (
                                      <div>
                                        <span className="font-medium text-gray-700">Shop:</span>
                                        <span className="text-gray-600 ml-1">{details.shop_name}</span>
                                      </div>
                                    )}
                                    <div className="text-xs text-gray-400 mt-2">
                                      {details.cached ? 'Loaded from cache' : 'Fetched from API'}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
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

"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Plus, FileText, Calendar, DollarSign, Trash2, Eye, ShoppingCart, ArrowLeft, Package, CheckCircle2, Loader2, Info, User, ArrowUp, ArrowDown, Lock, X, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProductDTO } from "@/types/product";
import { formatCurrency } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { templateManager } from "@/lib/template-manager";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Proposal {
  id: string;
  name: string;
  client_name?: string;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
  createdBy?: { email: string; name: string } | null;
  totalItems?: number;
  totalValue?: number;
  successfulItems?: number;
  products?: ProductDTO[];
  locked?: boolean;
}

export default function ProposalsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [proposalProducts, setProposalProducts] = useState<ProductDTO[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [userDismissedForm, setUserDismissedForm] = useState(false);
  const [proposalName, setProposalName] = useState("");
  const [clientName, setClientName] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveResult, setShowSaveResult] = useState(false);
  const [saveResult, setSaveResult] = useState<{ successful: number; failed: number; total: number; error?: string } | null>(null);
  const [filterMode, setFilterMode] = useState<'my' | 'all'>('all');
  const [sortField, setSortField] = useState<'name' | 'date'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Export state
  const [exportingProposalId, setExportingProposalId] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{ type: 'pdf' | 'pptx' | null; message: string }>({ type: null, message: '' });
  
  // Product details state
  const [productDetails, setProductDetails] = useState<Map<string, any>>(new Map());
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    }
  }, [status, router]);

  const loadProposalProducts = () => {
    console.log('Loading proposal products from localStorage...');
    const stored = localStorage.getItem('proposalProducts');
    console.log('Raw proposal products data:', stored);
    
    if (stored) {
      const parsed = JSON.parse(stored);
      console.log('Parsed proposal products:', parsed);
      setProposalProducts(parsed);
    } else {
      console.log('No proposal products found in localStorage');
    }
  };

  // Load proposals from server JSON files and products from localStorage
  const fetchProposalsData = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/proposals');
      if (response.ok) {
        const data = await response.json();
        setProposals(data.proposals || []);
      } else {
        console.error('Failed to fetch proposals from API');
        setProposals([]);
      }
    } catch (error) {
      console.error('Error fetching proposals:', error);
      setProposals([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProposalsData();
    loadProposalProducts();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchProposalsData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const userEmail = session?.user?.email;
  const filteredProposals = filterMode === 'all' || !userEmail
    ? proposals
    : proposals.filter(p => !p.createdBy || p.createdBy?.email === userEmail);

  const sortedProposals = [...filteredProposals].sort((a, b) => {
    const cmp = sortField === 'name'
      ? (a.name || '').localeCompare(b.name || '')
      : new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Show loading while checking auth
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-sky-500" />
      </div>
    );
  }
  // Don't render content if not authenticated
  if (!session) {
    return null;
  };

  // Fetch product details
  const fetchProductDetails = async (productId: string, platform: string) => {
    if (productDetails.has(productId) || loadingDetails.has(productId)) {
      return;
    }

    console.log(`Fetching details for product ${productId} from ${platform}`);
    setLoadingDetails(prev => new Set(prev).add(productId));
    
    try {
      const response = await fetch('/api/product-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, productId }),
      });
      
      console.log(`Response status: ${response.status}`);
      
      if (response.ok) {
        const details = await response.json();
        console.log('Product details received:', details);
        setProductDetails(prev => new Map(prev).set(productId, details));
      } else {
        const errorData = await response.json();
        console.error('Error response:', errorData);
      }
    } catch (error) {
      console.error('Failed to fetch product details:', error);
    } finally {
      setLoadingDetails(prev => {
        const newSet = new Set(prev);
        newSet.delete(productId);
        return newSet;
      });
    }
  };

  // Test function to manually fetch details
  const testFetchDetails = () => {
    if (proposalProducts.length > 0) {
      const firstProduct = proposalProducts[0];
      console.log('Test fetching details for:', firstProduct.id, firstProduct.source);
      fetchProductDetails(firstProduct.id, firstProduct.source);
    }
  };

  const handleDeleteProposal = async (proposalId: string) => {
    if (!confirm('Are you sure you want to delete this proposal?')) {
      return;
    }
    try {
      const response = await fetch(`/api/proposals?id=${encodeURIComponent(proposalId)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setProposals(prev => prev.filter(p => p.id !== proposalId));
        // Also remove from localStorage if present
        try {
          const stored = localStorage.getItem('proposals');
          if (stored) {
            const parsed = JSON.parse(stored);
            const updated = parsed.filter((p: any) => p.id !== proposalId);
            localStorage.setItem('proposals', JSON.stringify(updated));
          }
        } catch (e) { /* ignore localStorage errors */ }
      } else {
        alert('Failed to delete proposal');
      }
    } catch (error) {
      console.error('Error deleting proposal:', error);
      alert('Failed to delete proposal');
    }
  };

  const removeProduct = (productId: string) => {
    const updated = proposalProducts.filter(p => p.id !== productId);
    setProposalProducts(updated);
    localStorage.setItem('proposalProducts', JSON.stringify(updated));
  };

  const [savingProgress, setSavingProgress] = useState('');
  const [detailsProgress, setDetailsProgress] = useState({ current: 0, total: 0 });
  
  const handleSaveProposal = async () => {
    console.log('Save proposal clicked');
    console.log('Proposal name:', proposalName);
    
    if (!proposalName.trim()) {
      alert('Please enter a proposal name');
      return;
    }

    setIsSaving(true);
    setSavingProgress('Saving proposal...');

    const proposalId = `proposal_${Date.now()}`;
    const proposal = {
      id: proposalId,
      name: proposalName,
      client_name: clientName,
      currency: 'CNY',
      status: 'draft',
      notes,
      products: proposalProducts,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      totalItems: proposalProducts.length,
      totalValue: proposalProducts.reduce((sum, p) => sum + p.price.current, 0),
    };

    console.log('Proposal object:', proposal);

    try {
      // Step 1: Save proposal to localStorage
      setSavingProgress('Saving proposal to local storage...');
      const existingProposals = JSON.parse(localStorage.getItem('proposals') || '[]');
      existingProposals.unshift(proposal);
      localStorage.setItem('proposals', JSON.stringify(existingProposals));
      
      // Step 2: Create proposal structure on server (no detail fetching yet)
      const structureResponse = await fetch('/api/proposal-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId,
          proposalName,
          clientName,
          notes,
          products: proposalProducts,
          createdBy: session?.user ? {
            email: session.user.email || '',
            name: session.user.name || '',
          } : null,
          skipDetailsFetch: true,
        }),
      });
      if (!structureResponse.ok) throw new Error('Failed to create proposal structure');

      // Step 3: Fetch each product's details individually with progress tracking
      if (proposalProducts.length > 0) {
        const total = proposalProducts.length;
        setDetailsProgress({ current: 0, total });
        setSavingProgress(`Fetching item details...`);
        let successCount = 0;
        for (let i = 0; i < total; i++) {
          const product = proposalProducts[i];
          setDetailsProgress({ current: i + 1, total });
          try {
            const res = await fetch(
              `/api/proposal-details?proposalId=${proposalId}&productId=${product.source_id}&refresh=true`
            );
            if (res.ok) successCount++;
          } catch {
            // continue on error — failedCount incremented via total - successCount
          }
        }
        setDetailsProgress({ current: 0, total: 0 });
        setSaveResult({ successful: successCount, failed: total - successCount, total });
        setShowSaveResult(true);
      }
      
      localStorage.removeItem('proposalProducts');
      
      // Reload proposals from server
      await fetchProposalsData();
      setProposalProducts([]);
      setShowCreateForm(false);
      setUserDismissedForm(false);
      setProposalName('');
      setClientName('');
      setNotes('');
      
      if (proposalProducts.length === 0) {
        setSaveResult({ successful: 0, failed: 0, total: 0 });
        setShowSaveResult(true);
      }
    } catch (error) {
      console.error('Error saving proposal:', error);
      setSaveResult({ successful: 0, failed: 0, total: 0, error: 'Failed to save proposal. Please try again.' });
      setShowSaveResult(true);
    } finally {
      setIsSaving(false);
      setSavingProgress('');
    }
  };

  const handleExportPDF = async (proposalId: string, proposalName: string) => {
    setExportingProposalId(proposalId);
    setExportProgress({ type: 'pdf', message: 'Generating PDF...' });
    try {
      const res = await fetch(`/api/proposal-details?proposalId=${proposalId}`);
      if (!res.ok) throw new Error('Failed to load proposal data');
      const data = await res.json();

      const proposalWithDetails = {
        ...data,
        name: data.proposalName || proposalName || 'Proposal',
        client_name: data.clientName || data.client_name || '',
        products: (data.products || []).map((product: any) => {
          const details = data.itemDetails?.[product.source_id];
          const enrichment = data.aiEnrichments?.[product.source_id];
          return {
            ...product,
            aiEnrichment: enrichment,
            selectedSecondaryImages: details?.selectedSecondaryImages || [],
            selectedAIImages: details?.selectedAIImages || [],
            cachedDetails: details ? {
              desc: details.desc,
              props: details.props,
              sku: details.sku,
              num: details.num,
              shop_name: details.shop_name,
              item_imgs: details.item_imgs,
              category: details.category,
              category_id: details.category_id,
            } : undefined,
          };
        }),
      };

      const response = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal: proposalWithDetails, orientation: 'landscape' }),
      });
      if (!response.ok) throw new Error('Failed to generate PDF');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(proposalName || 'Proposal').replace(/[^a-z0-9]/gi, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF.');
    } finally {
      setExportingProposalId(null);
      setExportProgress({ type: null, message: '' });
    }
  };

  const handleExportPPTX = async (proposalId: string, proposalName: string, templateId?: string) => {
    setExportingProposalId(proposalId);
    setExportProgress({ type: 'pptx', message: 'Generating PowerPoint...' });
    try {
      const res = await fetch(`/api/proposal-details?proposalId=${proposalId}`);
      if (!res.ok) throw new Error('Failed to load proposal data');
      const data = await res.json();

      const proposalWithDetails = {
        ...data,
        name: data.proposalName || proposalName || 'Proposal',
        client_name: data.clientName || data.client_name || '',
        products: (data.products || []).map((product: any) => {
          const details = data.itemDetails?.[product.source_id];
          const enrichment = data.aiEnrichments?.[product.source_id];
          return {
            ...product,
            aiEnrichment: enrichment,
            selectedSecondaryImages: details?.selectedSecondaryImages || [],
            selectedAIImages: details?.selectedAIImages || [],
            cachedDetails: details ? {
              desc: details.desc,
              props: details.props,
              sku: details.sku,
              num: details.num,
              shop_name: details.shop_name,
              item_imgs: details.item_imgs,
              category: details.category,
              category_id: details.category_id,
            } : undefined,
          };
        }),
      };

      const response = await fetch('/api/export/pptx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal: proposalWithDetails, orientation: 'landscape', templateId: templateId || 'default' }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || `Server error ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(proposalName || 'Proposal').replace(/[^a-z0-9]/gi, '_')}.pptx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error exporting PPTX:', error);
      alert('Failed to export PPTX');
    } finally {
      setExportingProposalId(null);
      setExportProgress({ type: null, message: '' });
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

  const totalValue = proposalProducts.reduce((sum, p) => sum + p.price.current, 0);

  // Show create form only if user explicitly clicked create
  if (showCreateForm) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4 pt-24">
          <div className="mb-6">
            <Button
              variant="outline"
              onClick={() => {
                // Only go back if there are no products, otherwise ask for confirmation
                if (proposalProducts.length > 0) {
                  const confirmed = confirm('You have products in your proposal. Going back will keep them for later. Continue?');
                  if (!confirmed) return;
                }
                setShowCreateForm(false);
                setUserDismissedForm(true);
                setProposalName('');
                setClientName('');
                setNotes('');
              }}
              className="mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Proposals
            </Button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Create Proposal</h1>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Proposal Name *
                </label>
                <Input
                  value={proposalName}
                  onChange={(e) => setProposalName(e.target.value)}
                  placeholder="e.g., Q1 2026 Product Sourcing"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Client Name
                </label>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g., ABC Company"
                  className="w-full"
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes or special requirements..."
                rows={3}
                className="w-full"
              />
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Items: {proposalProducts.length}</p>
                  <p className="text-lg font-semibold text-gray-900">
                    Total Value: {formatCurrency(totalValue, 'CNY')}
                  </p>
                </div>
                <Button
                  onClick={handleSaveProposal}
                  disabled={isSaving}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {isSaving ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {detailsProgress.total > 0
                        ? `Fetching ${detailsProgress.current}/${detailsProgress.total}...`
                        : 'Saving...'}
                    </span>
                  ) : 'Save Proposal'}
                </Button>
              </div>
              {isSaving && detailsProgress.total > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Fetching item details...</span>
                    <span className="text-gray-900 font-medium">
                      {detailsProgress.current}/{detailsProgress.total}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(detailsProgress.current / detailsProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="font-semibold text-gray-900">Products ({proposalProducts.length})</h2>
                <div className="text-xs text-gray-500">
                  Details: {productDetails.size} | Loading: {loadingDetails.size}
                </div>
              </div>
              {proposalProducts.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testFetchDetails}
                  className="text-xs"
                >
                  Test Fetch Details
                </Button>
              )}
            </div>

            {proposalProducts.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <ShoppingCart className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <p>No products added yet.</p>
                <div className="mt-4">
                  <Button
                    onClick={() => router.push('/')}
                    className="bg-sky-600 hover:bg-sky-700 text-white"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Products
                  </Button>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {proposalProducts.map((product) => {
                  const details = productDetails.get(product.id);
                  const isLoading = loadingDetails.has(product.id);
                  
                  return (
                    <div key={product.id} className="p-6 hover:bg-gray-50 transition-colors">
                      <div className="flex gap-6">
                        <div className="flex-shrink-0">
                          <div className="w-32 h-32 bg-gray-100 rounded-lg overflow-hidden">
                            {details?.pic_url || product.image_urls[0] ? (
                              <img
                                src={details?.pic_url || product.image_urls[0]}
                                alt={details?.title || product.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400">
                                No image
                              </div>
                            )}
                          </div>
                          {(details?.item_imgs?.length > 0 || product.image_urls.length > 1) && (
                            <div className="mt-2 flex gap-2">
                              {(details?.item_imgs?.slice(0, 4) || product.image_urls.slice(1, 5)).map((img: any, idx: number) => (
                                <div key={idx} className="w-10 h-10 bg-gray-100 rounded overflow-hidden">
                                  <img 
                                    src={typeof img === 'string' ? img : img.url} 
                                    alt="" 
                                    className="w-full h-full object-cover" 
                                  />
                                </div>
                              ))}
                              {((details?.item_imgs?.length || product.image_urls.length - 1) > 4) && (
                                <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-600">
                                  +{((details?.item_imgs?.length || product.image_urls.length - 1) - 4)}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex-1">
                          <div className="flex items-start justify-between mb-2">
                            <h3 className="font-semibold text-gray-900">{details?.title || product.title}</h3>
                            {isLoading && (
                              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                            )}
                          </div>
                          
                          {details?.description && (
                            <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                              {details.description}
                            </p>
                          )}
                          
                          <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                            <div>
                              <span className="text-gray-600">Price:</span>
                              <span className="ml-2 font-semibold text-sky-600">
                                {formatCurrency(details?.price?.current || product.price.current, details?.price?.currency || product.price.currency)}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600">Platform:</span>
                              <span className="ml-2 capitalize">{product.source}</span>
                            </div>
                            {details?.moq || product.moq ? (
                              <div>
                                <span className="text-gray-600">MOQ:</span>
                                <span className="ml-2">{details?.moq || product.moq} units</span>
                              </div>
                            ) : null}
                            {details?.seller?.name && (
                              <div>
                                <span className="text-gray-600">Seller:</span>
                                <span className="ml-2">{details.seller.name}</span>
                              </div>
                            )}
                            {details?.seller?.rating && (
                              <div>
                                <span className="text-gray-600">Rating:</span>
                                <span className="ml-2">⭐ {details.seller.rating}</span>
                              </div>
                            )}
                            {details?.sales && (
                              <div>
                                <span className="text-gray-600">Sales:</span>
                                <span className="ml-2">{details.sales} sold</span>
                              </div>
                            )}
                          </div>

                          {details?.specifications && Object.keys(details.specifications).length > 0 && (
                            <div className="mb-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Info className="h-4 w-4 text-gray-500" />
                                <span className="text-sm font-medium text-gray-700">Specifications</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {Object.entries(details.specifications).slice(0, 4).map(([key, value]) => (
                                  <div key={key} className="text-gray-600">
                                    <span className="font-medium">{key}:</span> {String(value)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <a
                            href={product.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-sky-600 hover:text-sky-700"
                          >
                            View on {product.source}
                          </a>
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
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4 pt-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Proposals
          </h1>
          <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setSortField('name')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                sortField === 'name' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >Name</button>
            <button
              onClick={() => setSortField('date')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                sortField === 'date' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >Date</button>
            <button
              onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="px-2 py-1.5 rounded-md text-gray-600 hover:text-sky-700 transition-colors"
              title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            >
              {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setFilterMode('my')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                filterMode === 'my'
                  ? 'bg-white text-sky-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <User className="h-4 w-4 inline mr-1.5 -mt-0.5" />
              My Proposals
            </button>
            <button
              onClick={() => setFilterMode('all')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                filterMode === 'all'
                  ? 'bg-white text-sky-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <FileText className="h-4 w-4 inline mr-1.5 -mt-0.5" />
              All Proposals
            </button>
          </div>
          </div>
        </div>

        {/* Pending Products Alert */}
        {proposalProducts.length > 0 && (
          <div className="mb-8 bg-sky-50 border border-sky-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShoppingCart className="h-5 w-5 text-sky-600" />
                <div>
                  <p className="font-medium text-sky-900">
                    You have {proposalProducts.length} product{proposalProducts.length !== 1 ? 's' : ''} ready to add to a proposal
                  </p>
                  <p className="text-sm text-sky-700">
                    Total value: {formatCurrency(totalValue, 'CNY')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setProposalProducts([]);
                    localStorage.removeItem('proposalProducts');
                    router.push('/');
                  }}
                  className="border-gray-300 text-gray-600 hover:bg-gray-50"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setShowCreateForm(true);
                    setUserDismissedForm(false);
                  }}
                  className="bg-sky-600 hover:bg-sky-700 text-white relative"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add to New Proposal
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                    {proposalProducts.length}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {[
            { label: "Total Proposals", value: sortedProposals.length, icon: FileText },
            {
              label: "Draft",
              value: sortedProposals.filter((p) => p.status === "draft").length,
              icon: FileText,
            },
            {
              label: "Submitted",
              value: sortedProposals.filter((p) => p.status === "submitted").length,
              icon: FileText,
            },
          ].map((stat, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="bg-white border-gray-200">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
                      <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
                    </div>
                    <stat.icon className="h-8 w-8 text-sky-500" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Proposals List */}
        {isLoading ? (
          <div className="text-center py-20">
            <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-sky-500 border-r-transparent"></div>
            <p className="mt-4 text-gray-600">Loading proposals...</p>
          </div>
        ) : sortedProposals.length === 0 ? (
          <Card className="bg-white border-gray-200">
            <CardContent className="p-12 text-center">
              <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                No proposals yet
              </h3>
              <p className="text-gray-600 mb-6">
                Search for products and add them to create your first proposal
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedProposals.map((proposal, index) => (
              <motion.div
                key={proposal.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className={`bg-white border-gray-200 transition-all duration-200 group ${proposal.locked ? 'opacity-70 cursor-not-allowed' : 'hover:border-sky-300 hover:shadow-md'}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between mb-2">
                      <CardTitle className={`text-gray-900 transition-colors ${proposal.locked ? '' : 'group-hover:text-sky-600'}`}>
                        {proposal.name}
                      </CardTitle>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {proposal.locked && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
                            <Lock className="h-3 w-3" />
                            Processing
                          </span>
                        )}
                        <Badge className={getStatusColor(proposal.status)}>
                          {proposal.status}
                        </Badge>
                      </div>
                    </div>
                    {proposal.client_name && (
                      <p className="text-sm text-gray-600">
                        Client: {proposal.client_name}
                      </p>
                    )}
                    {proposal.createdBy?.name && (
                      <p className="text-xs text-gray-400 mt-1">
                        By: {proposal.createdBy.name}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 mb-4">
                      <div className="flex items-center text-sm text-gray-600">
                        <Calendar className="h-4 w-4 mr-2" />
                        {new Date(proposal.created_at).toLocaleDateString()}
                      </div>
                      <div className="flex items-center text-sm text-gray-600">
                        <Package className="h-4 w-4 mr-2" />
                        {proposal.totalItems || proposal.products?.length || 0} items
                      </div>
                      <div className="flex items-center text-sm text-gray-600">
                        <DollarSign className="h-4 w-4 mr-2" />
                        {proposal.totalValue ? formatCurrency(proposal.totalValue, proposal.currency) : proposal.currency}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {proposal.locked ? (
                        <div className="flex-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled
                            className="w-full border-gray-300 cursor-not-allowed"
                            title="Locked while batch AI job is in progress"
                          >
                            <Lock className="h-4 w-4 mr-1" />
                            Locked
                          </Button>
                        </div>
                      ) : (
                        <Link href={`/proposals/${proposal.id}`} className="flex-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full border-gray-300 hover:bg-gray-50"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                        </Link>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!!exportingProposalId}
                            className="border-sky-300 text-sky-600 hover:bg-sky-50"
                            title="Export"
                          >
                            {exportingProposalId === proposal.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onClick={() => handleExportPDF(proposal.id, proposal.name)}>
                            <FileText className="h-4 w-4 mr-2" />
                            Export as PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExportPPTX(proposal.id, proposal.name, 'default')}>
                            <FileText className="h-4 w-4 mr-2" />
                            Export PPTX (Default Template)
                          </DropdownMenuItem>
                          {templateManager.getTemplates().map((template) => (
                            <DropdownMenuItem
                              key={template.id}
                              onClick={() => handleExportPPTX(proposal.id, proposal.name, template.id)}
                            >
                              <FileText className="h-4 w-4 mr-2" />
                              Export PPTX ({template.name})
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteProposal(proposal.id)}
                        className="border-gray-300 hover:border-red-500 hover:text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
      {/* Export Progress Overlay */}
      {exportingProposalId && (
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
            <p className="text-gray-700 font-medium">{exportProgress.message}</p>
            <p className="text-sm text-gray-500">Please wait...</p>
          </div>
        </div>
      )}

      {showSaveResult && saveResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {saveResult.error ? 'Save Failed' : 'Proposal Save Summary'}
              </h2>
              <button onClick={() => setShowSaveResult(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {saveResult.error ? (
                <p className="text-sm text-red-600">{saveResult.error}</p>
              ) : (
                <div className="flex gap-4">
                  <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">{saveResult.successful}</p>
                    <p className="text-xs text-green-600 mt-1">Successful</p>
                  </div>
                  <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-red-700">{saveResult.failed}</p>
                    <p className="text-xs text-red-600 mt-1">Failed</p>
                  </div>
                  <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-gray-700">{saveResult.total}</p>
                    <p className="text-xs text-gray-600 mt-1">Total</p>
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <Button onClick={() => setShowSaveResult(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

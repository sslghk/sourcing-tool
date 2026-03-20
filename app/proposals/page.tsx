"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Plus, FileText, Calendar, DollarSign, Trash2, Eye, ShoppingCart, ArrowLeft, Package, CheckCircle2, Loader2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProductDTO } from "@/types/product";
import { formatCurrency } from "@/lib/utils";
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
  totalItems?: number;
  totalValue?: number;
  products?: ProductDTO[];
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

  // Load proposals and products
  useEffect(() => {
    const fetchProposalsData = async () => {
      try {
        console.log('Loading proposals from localStorage...');
        // Load from localStorage for now
        const stored = localStorage.getItem('proposals');
        console.log('Raw localStorage data:', stored);
        
        if (stored) {
          const parsed = JSON.parse(stored);
          console.log('Parsed proposals:', parsed);
          setProposals(parsed);
        } else {
          console.log('No proposals found in localStorage');
          setProposals([]);
        }
      } catch (error) {
        console.log("Error fetching proposals:", error);
        setProposals([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchProposalsData();
    loadProposalProducts();
  }, []);

  // Fetch details for all proposal products
  useEffect(() => {
    proposalProducts.forEach(product => {
      fetchProductDetails(product.id, product.source);
    });
  }, [proposalProducts]);

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

  const handleDeleteProposal = (proposalId: string) => {
    if (!confirm('Are you sure you want to delete this proposal?')) {
      return;
    }
    const updated = proposals.filter(p => p.id !== proposalId);
    setProposals(updated);
    localStorage.setItem('proposals', JSON.stringify(updated));
  };

  const removeProduct = (productId: string) => {
    const updated = proposalProducts.filter(p => p.id !== productId);
    setProposalProducts(updated);
    localStorage.setItem('proposalProducts', JSON.stringify(updated));
  };

  const handleSaveProposal = async () => {
    console.log('Save proposal clicked');
    console.log('Proposal name:', proposalName);
    
    if (!proposalName.trim()) {
      alert('Please enter a proposal name');
      return;
    }

    setIsSaving(true);

    const proposal = {
      id: `proposal_${Date.now()}`,
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
      const existingProposals = JSON.parse(localStorage.getItem('proposals') || '[]');
      console.log('Existing proposals before save:', existingProposals);
      
      existingProposals.unshift(proposal);
      localStorage.setItem('proposals', JSON.stringify(existingProposals));
      console.log('Proposals saved to localStorage');
      
      // Verify it was saved
      const savedProposals = JSON.parse(localStorage.getItem('proposals') || '[]');
      console.log('Proposals after save verification:', savedProposals);
      
      localStorage.removeItem('proposalProducts');
      
      setProposals(existingProposals);
      setProposalProducts([]);
      setShowCreateForm(false);
      setUserDismissedForm(false);
      setProposalName('');
      setClientName('');
      setNotes('');
      
      alert('Proposal saved successfully!');
    } catch (error) {
      console.error('Error saving proposal:', error);
      alert('Failed to save proposal');
    } finally {
      setIsSaving(false);
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
                  {isSaving ? 'Saving...' : 'Save Proposal'}
                </Button>
              </div>
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
          <Button 
            onClick={() => {
              setShowCreateForm(true);
              setUserDismissedForm(false);
            }}
            className="bg-sky-500 hover:bg-sky-600 text-white relative"
          >
            <Plus className="h-5 w-5 mr-2" />
            New Proposal
            {proposalProducts.length > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center">
                {proposalProducts.length}
              </span>
            )}
          </Button>
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
              <Button
                onClick={() => {
                  setShowCreateForm(true);
                  setUserDismissedForm(false);
                }}
                className="bg-sky-600 hover:bg-sky-700 text-white"
              >
                Create Proposal
              </Button>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {[
            { label: "Total Proposals", value: proposals.length, icon: FileText },
            {
              label: "Draft",
              value: proposals.filter((p) => p.status === "draft").length,
              icon: FileText,
            },
            {
              label: "Submitted",
              value: proposals.filter((p) => p.status === "submitted").length,
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
        ) : proposals.length === 0 ? (
          <Card className="bg-white border-gray-200">
            <CardContent className="p-12 text-center">
              <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                No proposals yet
              </h3>
              <p className="text-gray-600 mb-6">
                Create your first proposal to get started
              </p>
              <Button 
                onClick={() => {
                  setShowCreateForm(true);
                  setUserDismissedForm(false);
                }}
                className="bg-sky-500 hover:bg-sky-600 text-white"
              >
                <Plus className="h-5 w-5 mr-2" />
                Create Proposal
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {proposals.map((proposal, index) => (
              <motion.div
                key={proposal.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="bg-white border-gray-200 hover:border-sky-300 hover:shadow-md transition-all duration-200 group">
                  <CardHeader>
                    <div className="flex items-start justify-between mb-2">
                      <CardTitle className="text-gray-900 group-hover:text-sky-600 transition-colors">
                        {proposal.name}
                      </CardTitle>
                      <Badge className={getStatusColor(proposal.status)}>
                        {proposal.status}
                      </Badge>
                    </div>
                    {proposal.client_name && (
                      <p className="text-sm text-gray-600">
                        Client: {proposal.client_name}
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
                      {proposal.products && proposal.products.length > 0 && (
                        <div className="flex items-center text-sm">
                          {(() => {
                            const productsWithDetails = proposal.products.filter(p => p.cachedDetails);
                            const allHaveDetails = productsWithDetails.length === proposal.products.length;
                            return allHaveDetails ? (
                              <div className="flex items-center text-green-600">
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                                All details loaded
                              </div>
                            ) : productsWithDetails.length > 0 ? (
                              <div className="flex items-center text-amber-600">
                                <Loader2 className="h-4 w-4 mr-2" />
                                {productsWithDetails.length}/{proposal.products.length} details loaded
                              </div>
                            ) : (
                              <div className="flex items-center text-gray-500">
                                <Loader2 className="h-4 w-4 mr-2" />
                                No details loaded
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
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
    </div>
  );
}

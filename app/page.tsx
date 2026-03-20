"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { SearchBar } from "@/components/search/search-bar";
import { PlatformSelector } from "@/components/search/platform-selector";
import { ProductTable } from "@/components/products/product-table";
import { ProductCardView } from "@/components/products/product-card-view";
import { PriceFilter } from "@/components/filters/price-filter";
import { Platform, ProductDTO } from "@/types/product";
import { Loader2, Package, ShoppingCart, Download, FileJson, FileSpreadsheet, SlidersHorizontal, LayoutGrid, List, X, FolderOpen, FileImage, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { 
  convertToCSV, 
  convertToJSON, 
  downloadFile, 
  fetchDetailedProductInfo,
  type ExportFormat,
  type ExportMode 
} from "@/lib/export";

interface SearchTab {
  id: string;
  label: string;
  query: string;
  type: 'text' | 'image' | 'similar';
  products: ProductDTO[];
  timestamp: Date;
  platforms: Platform[];
}

export default function Home() {
  const router = useRouter();
  const { data: session, status } = useSession();
  
  // All useState hooks must be at the top, before any conditional returns
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([
    "taobao",
  ]);
  const [searchTabs, setSearchTabs] = useState<SearchTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAddingToProposal, setIsAddingToProposal] = useState(false);
  const [findingSimilarFor, setFindingSimilarFor] = useState<string | null>(null);
  const [proposalProducts, setProposalProducts] = useState<ProductDTO[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>('basic');
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [priceFilter, setPriceFilter] = useState<{ min: number; max: number } | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [isDedupe, setIsDedupe] = useState(true);
  
  // Folder upload state
  const [isProcessingFolder, setIsProcessingFolder] = useState(false);
  const [folderImages, setFolderImages] = useState<File[]>([]);
  const [currentProcessingIndex, setCurrentProcessingIndex] = useState(0);
  const [proposalName, setProposalName] = useState('');
  const [autoCreateProposal, setAutoCreateProposal] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  
  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    }
  }, [status, router]);

  // Compute ALL values with useMemo BEFORE any conditional returns
  const activeTab = searchTabs.find(tab => tab.id === activeTabId);
  const searchResults = activeTab?.products || [];
  const hasSearched = searchTabs.length > 0;

  const selectedCountByTabId = useMemo(() => {
    const result = new Map<string, number>();
    for (const tab of searchTabs) {
      let count = 0;
      for (const product of tab.products) {
        if (selectedProducts.has(product.id)) {
          count += 1;
        }
      }
      result.set(tab.id, count);
    }
    return result;
  }, [searchTabs, selectedProducts]);

  // Calculate price range from search results
  const priceRange = useMemo(() => {
    if (searchResults.length === 0) return { min: 0, max: 1000 };
    
    const prices = searchResults.map(p => p.price.current);
    return {
      min: Math.floor(Math.min(...prices)),
      max: Math.ceil(Math.max(...prices))
    };
  }, [searchResults]);

  // Filter products by price range, dedupe, and sort by price
  const filteredProducts = useMemo(() => {
    let products = priceFilter 
      ? searchResults.filter(product => 
          product.price.current >= priceFilter.min && 
          product.price.current <= priceFilter.max
        )
      : searchResults;
    
    // Deduplicate by title OR image if enabled
    if (isDedupe) {
      const seenTitles = new Map<string, ProductDTO>();
      const seenImages = new Map<string, ProductDTO>();
      const uniqueProducts = new Map<string, ProductDTO>();
      
      products.forEach(product => {
        const normalizedTitle = product.title.toLowerCase().trim();
        const primaryImage = product.image_urls?.[0] || '';
        const normalizedImage = primaryImage.replace(/^https?:/, '').replace(/^\/\//, '');
        
        let isDuplicate = false;
        
        // Check if title already seen
        if (normalizedTitle && seenTitles.has(normalizedTitle)) {
          const existing = seenTitles.get(normalizedTitle)!;
          if (product.price.current < existing.price.current) {
            // Replace with cheaper version
            uniqueProducts.delete(existing.id);
            seenTitles.set(normalizedTitle, product);
            if (normalizedImage) seenImages.set(normalizedImage, product);
            uniqueProducts.set(product.id, product);
          }
          isDuplicate = true;
        }
        
        // Check if image already seen
        if (normalizedImage && seenImages.has(normalizedImage)) {
          const existing = seenImages.get(normalizedImage)!;
          if (product.price.current < existing.price.current) {
            // Replace with cheaper version
            uniqueProducts.delete(existing.id);
            if (normalizedTitle) seenTitles.set(normalizedTitle, product);
            seenImages.set(normalizedImage, product);
            uniqueProducts.set(product.id, product);
          }
          isDuplicate = true;
        }
        
        // If not a duplicate, add it
        if (!isDuplicate) {
          if (normalizedTitle) seenTitles.set(normalizedTitle, product);
          if (normalizedImage) seenImages.set(normalizedImage, product);
          uniqueProducts.set(product.id, product);
        }
      });
      
      products = Array.from(uniqueProducts.values());
    }
    
    // Sort by price (ascending) by default
    return [...products].sort((a, b) => a.price.current - b.price.current);
  }, [searchResults, priceFilter, isDedupe]);

  // Load proposal products and tabs from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('proposalProducts');
    if (stored) {
      setProposalProducts(JSON.parse(stored));
    }
    
    // Load search tabs from sessionStorage
    const storedTabs = sessionStorage.getItem('searchTabs');
    const storedActiveTabId = sessionStorage.getItem('activeTabId');
    if (storedTabs) {
      const tabs = JSON.parse(storedTabs);
      setSearchTabs(tabs.map((tab: any) => ({
        ...tab,
        timestamp: new Date(tab.timestamp)
      })));
    }
    if (storedActiveTabId) {
      setActiveTabId(storedActiveTabId);
    }
  }, []);

  // Save to localStorage whenever proposalProducts changes
  useEffect(() => {
    if (proposalProducts.length > 0) {
      localStorage.setItem('proposalProducts', JSON.stringify(proposalProducts));
    }
  }, [proposalProducts]);

  // Save search tabs to sessionStorage whenever they change
  useEffect(() => {
    if (searchTabs.length > 0) {
      sessionStorage.setItem('searchTabs', JSON.stringify(searchTabs));
    }
  }, [searchTabs]);

  // Save active tab ID to sessionStorage
  useEffect(() => {
    if (activeTabId) {
      sessionStorage.setItem('activeTabId', activeTabId);
    }
  }, [activeTabId]);

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
  }

  // Helper function to create a new tab
  const createNewTab = (query: string, type: 'text' | 'image' | 'similar', products: ProductDTO[], platforms: Platform[]) => {
    const newTab: SearchTab = {
      id: `tab-${Date.now()}`,
      label: query.length > 30 ? query.substring(0, 30) + '...' : query,
      query,
      type,
      products,
      timestamp: new Date(),
      platforms
    };
    
    setSearchTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  // Helper function to close a tab
  const closeTab = (tabId: string) => {
    setSearchTabs(prev => {
      const filtered = prev.filter(tab => tab.id !== tabId);
      
      // If closing active tab, switch to another tab
      if (tabId === activeTabId) {
        if (filtered.length > 0) {
          const index = prev.findIndex(tab => tab.id === tabId);
          const newActiveIndex = index > 0 ? index - 1 : 0;
          setActiveTabId(filtered[newActiveIndex]?.id || null);
        } else {
          setActiveTabId(null);
        }
      }
      
      return filtered;
    });
  };

  const handleAddToProposal = async (product: ProductDTO) => {
    // Check if product already in proposal
    if (proposalProducts.some(p => p.id === product.id)) {
      return;
    }
    
    // Fetch details for the product using source_id
    try {
      const response = await fetch(`/api/product-details?productId=${product.source_id}&platform=${product.source}`);
      if (response.ok) {
        const details = await response.json();
        const productWithDetails = {
          ...product,
          cachedDetails: details,
          detailsFetchedAt: new Date().toISOString()
        };
        setProposalProducts([...proposalProducts, productWithDetails]);
      } else {
        // Add without details if fetch fails
        setProposalProducts([...proposalProducts, product]);
      }
    } catch (error) {
      console.error(`Failed to fetch details for ${product.source_id}:`, error);
      // Add without details if fetch fails
      setProposalProducts([...proposalProducts, product]);
    }
  };

  const handleAddSelectedToProposal = async () => {
    setIsAddingToProposal(true);
    
    try {
      // Gather selected products from ALL tabs, not just the active one
      const allProducts: ProductDTO[] = [];
      searchTabs.forEach(tab => {
        const tabSelectedProducts = tab.products.filter(p => selectedProducts.has(p.id));
        allProducts.push(...tabSelectedProducts);
      });
      
      const newProposalProducts = [...proposalProducts];
      
      // Fetch details for selected products that aren't already in proposal
      const productsToAdd = allProducts.filter(
        product => !newProposalProducts.some(p => p.id === product.id)
      );
      
      // Fetch details for each product in parallel
      const productsWithDetails = await Promise.all(
        productsToAdd.map(async (product) => {
          try {
            const response = await fetch(`/api/product-details?productId=${product.source_id}&platform=${product.source}`);
            if (response.ok) {
              const details = await response.json();
              // Store details with the product
              return {
                ...product,
                cachedDetails: details,
                detailsFetchedAt: new Date().toISOString()
              };
            }
          } catch (error) {
            console.error(`Failed to fetch details for ${product.source_id}:`, error);
          }
          // Return product without details if fetch fails
          return product;
        })
      );
      
      newProposalProducts.push(...productsWithDetails);
      setProposalProducts(newProposalProducts);
      setSelectedProducts(new Set());
      
      // Navigate to proposals page with animation
      setTimeout(() => {
        router.push('/proposals');
      }, 300);
    } finally {
      setIsAddingToProposal(false);
    }
  };

  const handlePriceFilterChange = (min: number, max: number) => {
    setPriceFilter({ min, max });
  };

  const handleFindSimilar = async (product: ProductDTO) => {
    setFindingSimilarFor(product.id);
    
    try {
      // Get the product's main image URL
      const imageUrl = product.image_urls[0];
      if (!imageUrl) {
        alert('No image available for this product');
        return;
      }
      
      setIsLoading(true);
      
      // Fetch the image and convert to File
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], 'product-image.jpg', { type: blob.type });
      
      // Perform image search
      const formData = new FormData();
      formData.append('image', file);
      
      const searchResponse = await fetch('/api/search-image', {
        method: 'POST',
        body: formData,
      });
      
      if (!searchResponse.ok) {
        const errorData = await searchResponse.json();
        throw new Error(errorData.error || 'Image search failed');
      }
      
      const data = await searchResponse.json();
      
      // Create new tab for similar products
      const tabLabel = product.title.length > 25 ? product.title.substring(0, 25) + '...' : product.title;
      createNewTab(`Similar: ${tabLabel}`, 'similar', data.products || [], ['taobao']);
      
      // Scroll to top to see results
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Error finding similar products:', error);
      alert('Failed to find similar products. Please try again.');
    } finally {
      setFindingSimilarFor(null);
      setIsLoading(false);
    }
  };

  const handleImageSearch = async (image: File) => {
    console.log('Image search triggered with file:', image.name);
    setIsLoading(true);
    
    try {
      const formData = new FormData();
      formData.append('image', image);
      
      const response = await fetch('/api/search-image', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Image search failed');
      }
      
      const data = await response.json();
      
      // Create new tab for image search results
      createNewTab(`Image: ${image.name}`, 'image', data.products || [], ['taobao']);
      
      console.log(`Found ${data.products?.length || 0} products from image search`);
    } catch (error) {
      console.error('Image search error:', error);
      alert(error instanceof Error ? error.message : 'Failed to search by image. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    if (searchResults.length === 0) {
      alert('No results to export');
      return;
    }

    setIsExporting(true);

    try {
      let productsToExport = [...searchResults];

      // If detailed mode, fetch detailed info for all products
      if (exportMode === 'detailed') {
        const detailedProducts = await Promise.all(
          searchResults.map(async (product) => {
            const detailedInfo = await fetchDetailedProductInfo(product.id);
            return {
              ...product,
              detailedInfo
            };
          })
        );
        productsToExport = detailedProducts;
      }

      // Convert to selected format
      let content: string;
      let filename: string;
      let mimeType: string;

      if (format === 'csv') {
        content = convertToCSV(productsToExport, exportMode);
        filename = `search-results-${exportMode}-${Date.now()}.csv`;
        mimeType = 'text/csv';
      } else {
        content = convertToJSON(productsToExport, exportMode);
        filename = `search-results-${exportMode}-${Date.now()}.json`;
        mimeType = 'application/json';
      }

      // Download file
      downloadFile(content, filename, mimeType);
      
      alert(`Exported ${searchResults.length} products as ${format.toUpperCase()} (${exportMode} mode)`);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export results');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) return;

    setIsLoading(true);

    const requestData = {
      query,
      platforms: selectedPlatforms,
      page: 1,
      limit: 20,
    };

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        console.log("Search API not available yet, showing empty results");
        createNewTab(query, 'text', [], selectedPlatforms);
        return;
      }

      const data = await response.json();
      
      // Create new tab for text search results
      createNewTab(query, 'text', data.products || [], selectedPlatforms);
    } catch (error) {
      console.log("Search error:", error);
      createNewTab(query, 'text', [], selectedPlatforms);
    } finally {
      setIsLoading(false);
    }
  };

  // Folder upload functions
  const handleFolderSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    setFolderImages(imageFiles);
    
    // Auto-generate proposal name from count
    if (imageFiles.length > 0) {
      setProposalName(`Batch Search ${new Date().toLocaleDateString()}`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    setFolderImages(imageFiles);
    
    // Auto-generate proposal name
    if (imageFiles.length > 0) {
      setProposalName(`Batch Search ${new Date().toLocaleDateString()}`);
    }
  };

  const processFolderImages = async () => {
    if (folderImages.length === 0) return;
    
    setIsProcessingFolder(true);
    setCurrentProcessingIndex(0);
    const allFoundProducts: ProductDTO[] = [];
    
    // Clear existing tabs and proposal products
    setSearchTabs([]);
    setProposalProducts([]);
    
    try {
      for (let i = 0; i < folderImages.length; i++) {
        const file = folderImages[i];
        setCurrentProcessingIndex(i + 1);
        
        try {
          // Perform image search
          const formData = new FormData();
          formData.append('image', file);
          
          const response = await fetch('/api/search-image', {
            method: 'POST',
            body: formData,
          });
          
          if (response.ok) {
            const data = await response.json();
            const products = data.products || [];
            
            // Create tab for this image
            const tabLabel = file.name.length > 25 ? file.name.substring(0, 25) + '...' : file.name;
            createNewTab(`Folder: ${tabLabel}`, 'image', products, ['taobao']);
            
            // Add products to collection
            allFoundProducts.push(...products);
            
            // Add delay to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error);
        }
      }
      
      // Auto-create proposal if enabled
      if (autoCreateProposal && allFoundProducts.length > 0) {
        // Remove duplicates and add to proposal
        const uniqueProducts = new Map<string, ProductDTO>();
        allFoundProducts.forEach(product => {
          if (!uniqueProducts.has(product.id)) {
            uniqueProducts.set(product.id, product);
          }
        });
        
        const finalProducts = Array.from(uniqueProducts.values());
        setProposalProducts(finalProducts);
        
        // Navigate to proposals page
        setTimeout(() => {
          router.push('/proposals');
        }, 1000);
      }
    } finally {
      setIsProcessingFolder(false);
      setCurrentProcessingIndex(0);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-4 pt-24 pb-12">
        <div className="mb-8 mt-12 max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900">
            Sourcing Assistant
          </h1>
        </div>
        
        <div className="space-y-8 mb-12 max-w-5xl mx-auto">
          {/* Folder Upload Section */}
          <Card className="shadow-lg border-0">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <FolderOpen className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <CardTitle>Batch Image Search</CardTitle>
                  <CardDescription>Upload a folder of images to search and create a proposal automatically</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Folder Input */}
              <div 
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                  isDragging 
                    ? 'border-green-500 bg-green-50' 
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => document.getElementById('folder-upload')?.click()}
              >
                <input
                  type="file"
                  id="folder-upload"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={handleFolderSelect}
                  disabled={isProcessingFolder}
                />
                <div className="flex flex-col items-center gap-3">
                  <FolderOpen className="h-12 w-12 text-gray-400" />
                  <div>
                    <p className="text-lg font-medium text-gray-700">
                      {folderImages.length > 0 ? `${folderImages.length} images selected` : 'Drag & drop images here'}
                    </p>
                    <p className="text-sm text-gray-500">
                      Or click to select multiple image files
                    </p>
                  </div>
                  <Button 
                    type="button" 
                    variant="outline"
                    disabled={isProcessingFolder}
                    onClick={(e) => {
                      e.stopPropagation();
                      const input = document.getElementById('folder-upload') as HTMLInputElement;
                      if (input) {
                        console.log('Triggering file input click');
                        input.click();
                      } else {
                        console.error('File input not found');
                      }
                    }}
                  >
                    <FileImage className="h-4 w-4 mr-2" />
                    Select Images
                  </Button>
                  <Button 
                    type="button" 
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      console.log('Current folderImages:', folderImages.length);
                      alert(`Selected images: ${folderImages.length}`);
                    }}
                  >
                    Test
                  </Button>
                </div>
              </div>

              {/* Selected Images Preview */}
              {folderImages.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">
                      Selected Images: {folderImages.length}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFolderImages([])}
                      disabled={isProcessingFolder}
                    >
                      Clear
                    </Button>
                  </div>
                  
                  {/* Settings */}
                  <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Proposal name"
                        value={proposalName}
                        onChange={(e) => setProposalName(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="auto-proposal"
                        checked={autoCreateProposal}
                        onChange={(e) => setAutoCreateProposal(e.target.checked)}
                        className="rounded"
                      />
                      <label htmlFor="auto-proposal" className="text-sm text-gray-700">
                        Auto-create proposal
                      </label>
                    </div>
                  </div>

                  {/* Process Button */}
                  <Button
                    onClick={processFolderImages}
                    disabled={isProcessingFolder || folderImages.length === 0}
                    className="w-full"
                  >
                    {isProcessingFolder ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing {currentProcessingIndex}/{folderImages.length}...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Process Images & Create Proposal
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* Processing Status */}
              {isProcessingFolder && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Processing images...</span>
                    <span className="text-gray-900 font-medium">
                      {currentProcessingIndex}/{folderImages.length}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(currentProcessingIndex / folderImages.length) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <SearchBar 
            onSearch={handleSearch} 
            onImageSearch={handleImageSearch}
            isLoading={isLoading || isProcessingFolder} 
          />
        </div>

        {/* Search Tabs */}
        {searchTabs.length > 0 && (
          <div className="max-w-5xl mx-auto mb-6">
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {searchTabs.map((tab) => (
                <motion.div
                  key={tab.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all cursor-pointer flex-shrink-0 ${
                    tab.id === activeTabId
                      ? 'bg-sky-50 border-sky-400 shadow-sm'
                      : 'bg-white border-gray-200 hover:border-sky-300'
                  }`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${
                      tab.id === activeTabId ? 'text-sky-700' : 'text-gray-700'
                    }`}>
                      {tab.label}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      tab.id === activeTabId 
                        ? 'bg-sky-100 text-sky-600' 
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {(selectedCountByTabId.get(tab.id) ?? 0)}/{tab.products.length}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className={`hover:bg-gray-200 rounded p-1 transition-colors ${
                      tab.id === activeTabId ? 'text-sky-600' : 'text-gray-400'
                    }`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        <div className="max-w-5xl mx-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="h-12 w-12 animate-spin text-sky-500 mb-4" />
              <p className="text-gray-600">Searching across platforms...</p>
            </div>
          ) : searchResults.length > 0 ? (
            <>
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <p className="text-gray-700 font-medium">
                    {filteredProducts.length} products found
                    {priceFilter && filteredProducts.length !== searchResults.length && (
                      <span className="text-sm text-gray-500 ml-2">
                        (filtered from {searchResults.length})
                      </span>
                    )}
                  </p>
                  
                  {selectedProducts.size > 0 && (
                    <p className="text-gray-700 font-medium">
                      • {selectedProducts.size} {selectedProducts.size === 1 ? 'item' : 'items'} selected
                    </p>
                  )}
                  
                  {proposalProducts.length > 0 && (
                    <p className="text-gray-700 font-medium">
                      • {proposalProducts.length} items in proposal
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {/* View Mode Toggle */}
                  <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewMode('table')}
                      className={`rounded-none border-0 ${
                        viewMode === 'table' ? 'bg-sky-100 text-sky-700' : 'text-gray-600'
                      }`}
                    >
                      <List className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewMode('card')}
                      className={`rounded-none border-0 ${
                        viewMode === 'card' ? 'bg-sky-100 text-sky-700' : 'text-gray-600'
                      }`}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </Button>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                    className={isFilterOpen ? "bg-sky-50 border-sky-300" : ""}
                  >
                    <SlidersHorizontal className="h-4 w-4 mr-2" />
                    Filters
                  </Button>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm"
                        disabled={isExporting}
                      >
                        {isExporting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Exporting...
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-2" />
                            Export
                          </>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuLabel>Export Options</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      
                      <div className="px-2 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {exportMode === 'basic' ? 'Basic Info' : 'Detailed Info'}
                          </span>
                          <Switch
                            checked={exportMode === 'detailed'}
                            onCheckedChange={(checked: boolean) => setExportMode(checked ? 'detailed' : 'basic')}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {exportMode === 'basic' 
                            ? 'Export basic product information' 
                            : 'Include seller details, MOQ, sales volume'}
                        </p>
                      </div>
                      
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Export Format</DropdownMenuLabel>
                      
                      <DropdownMenuItem onClick={() => handleExport('csv')}>
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        Export as CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExport('json')}>
                        <FileJson className="h-4 w-4 mr-2" />
                        Export as JSON
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        disabled={selectedProducts.size === 0 || isAddingToProposal}
                        className="bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isAddingToProposal ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Adding...
                          </>
                        ) : (
                          <>
                            <ShoppingCart className="h-4 w-4 mr-2" />
                            Add Selected
                          </>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Add to Proposal</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      
                      <DropdownMenuItem onClick={handleAddSelectedToProposal}>
                        <Package className="h-4 w-4 mr-2" />
                        Add to New Proposal
                      </DropdownMenuItem>
                      
                      {proposalProducts.length > 0 && (
                        <DropdownMenuItem onClick={() => {
                          const selected = filteredProducts.filter(p => selectedProducts.has(p.id));
                          const newProposalProducts = [...proposalProducts];
                          
                          selected.forEach(product => {
                            if (!newProposalProducts.some(p => p.id === product.id)) {
                              newProposalProducts.push(product);
                            }
                          });
                          
                          setProposalProducts(newProposalProducts);
                          setSelectedProducts(new Set());
                        }}>
                          <ShoppingCart className="h-4 w-4 mr-2" />
                          Add to Current Proposal ({proposalProducts.length} items)
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Expandable Filter Menu */}
              <motion.div
                initial={false}
                animate={{
                  height: isFilterOpen ? "auto" : 0,
                  opacity: isFilterOpen ? 1 : 0,
                  marginBottom: isFilterOpen ? 16 : 0,
                }}
                transition={{
                  duration: 0.3,
                  ease: "easeInOut"
                }}
                className="overflow-hidden"
              >
                <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                  <div className="space-y-4">
                    {/* Platform and Remove Duplicates on same row */}
                    <div className="flex gap-6 items-start">
                      <div className="flex-1">
                        <h3 className="text-xs font-semibold text-gray-900 mb-2">Platform</h3>
                        <PlatformSelector
                          selectedPlatforms={selectedPlatforms}
                          onPlatformsChange={setSelectedPlatforms}
                        />
                      </div>
                      
                      <div className="flex-shrink-0 pt-6">
                        <div className="flex items-center gap-3">
                          <div>
                            <h3 className="text-xs font-semibold text-gray-900">Remove Duplicates</h3>
                            <p className="text-xs text-gray-500 mt-0.5">Keep lowest price</p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isDedupe}
                              onChange={(e) => setIsDedupe(e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-600"></div>
                          </label>
                        </div>
                      </div>
                    </div>
                    
                    {/* Price Range on its own row */}
                    <div className="border-t pt-4">
                      <h3 className="text-xs font-semibold text-gray-900 mb-2">Price Range</h3>
                      <div className="max-w-sm">
                        <PriceFilter
                          minPrice={priceRange.min}
                          maxPrice={priceRange.max}
                          onFilterChange={handlePriceFilterChange}
                          currency="CNY"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>

              {viewMode === 'table' ? (
                <ProductTable 
                  products={filteredProducts} 
                  onAddToProposal={handleAddToProposal}
                  selectedProducts={selectedProducts}
                  setSelectedProducts={setSelectedProducts}
                  onFindSimilar={handleFindSimilar}
                  findingSimilarFor={findingSimilarFor}
                />
              ) : (
                <ProductCardView
                  products={filteredProducts}
                  onAddToProposal={handleAddToProposal}
                  selectedProducts={selectedProducts}
                  setSelectedProducts={setSelectedProducts}
                />
              )}
            </>
          ) : (
            <>
              <div className="mb-6">
                <p className="text-gray-500 text-sm">
                  {hasSearched 
                    ? "No products found. Try a different search term."
                    : "Enter a search term above to find products"}
                </p>
              </div>
              
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm mx-auto">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Image
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider min-w-[300px]">
                          Product
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Price
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          MOQ
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Location
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Platform
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-200">
                        <td className="px-4 py-8" colSpan={7}>
                          <div className="text-center text-gray-400">
                            <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No results yet</p>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

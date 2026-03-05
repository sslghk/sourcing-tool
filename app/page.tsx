"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { SearchBar } from "@/components/search/search-bar";
import { PlatformSelector } from "@/components/search/platform-selector";
import { ProductTable } from "@/components/products/product-table";
import { PriceFilter } from "@/components/filters/price-filter";
import { Platform, ProductDTO } from "@/types/product";
import { Loader2, Package, ShoppingCart, Download, FileJson, FileSpreadsheet, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export default function Home() {
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([
    "taobao",
  ]);
  const [searchResults, setSearchResults] = useState<ProductDTO[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    query: string;
    platforms: Platform[];
    response: any;
    timestamp: string;
  } | null>(null);
  const [proposalProducts, setProposalProducts] = useState<ProductDTO[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>('basic');
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [priceFilter, setPriceFilter] = useState<{ min: number; max: number } | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Load proposal products from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('proposalProducts');
    if (stored) {
      setProposalProducts(JSON.parse(stored));
    }
    
    // Load search results from sessionStorage
    const storedResults = sessionStorage.getItem('searchResults');
    const storedHasSearched = sessionStorage.getItem('hasSearched');
    if (storedResults) {
      setSearchResults(JSON.parse(storedResults));
    }
    if (storedHasSearched === 'true') {
      setHasSearched(true);
    }
  }, []);

  // Save to localStorage whenever proposalProducts changes
  useEffect(() => {
    if (proposalProducts.length > 0) {
      localStorage.setItem('proposalProducts', JSON.stringify(proposalProducts));
    }
  }, [proposalProducts]);

  // Save search results to sessionStorage whenever they change
  useEffect(() => {
    if (searchResults.length > 0) {
      sessionStorage.setItem('searchResults', JSON.stringify(searchResults));
      sessionStorage.setItem('hasSearched', 'true');
    }
  }, [searchResults]);

  const handleAddToProposal = async (product: ProductDTO) => {
    // Check if product already in proposal
    if (proposalProducts.some(p => p.id === product.id)) {
      return;
    }
    
    // Fetch details for the product
    try {
      const response = await fetch(`/api/product-details?productId=${product.id}&platform=${product.source}`);
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
      console.error(`Failed to fetch details for ${product.id}:`, error);
      // Add without details if fetch fails
      setProposalProducts([...proposalProducts, product]);
    }
  };

  const handleAddSelectedToProposal = async () => {
    const selected = searchResults.filter(p => selectedProducts.has(p.id));
    const newProposalProducts = [...proposalProducts];
    
    // Fetch details for selected products that aren't already in proposal
    const productsToAdd = selected.filter(
      product => !newProposalProducts.some(p => p.id === product.id)
    );
    
    // Fetch details for each product in parallel
    const productsWithDetails = await Promise.all(
      productsToAdd.map(async (product) => {
        try {
          const response = await fetch(`/api/product-details?productId=${product.id}&platform=${product.source}`);
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
          console.error(`Failed to fetch details for ${product.id}:`, error);
        }
        // Return product without details if fetch fails
        return product;
      })
    );
    
    newProposalProducts.push(...productsWithDetails);
    setProposalProducts(newProposalProducts);
    setSelectedProducts(new Set());
  };

  // Calculate price range from search results
  const priceRange = useMemo(() => {
    if (searchResults.length === 0) return { min: 0, max: 1000 };
    
    const prices = searchResults.map(p => p.price.current);
    return {
      min: Math.floor(Math.min(...prices)),
      max: Math.ceil(Math.max(...prices))
    };
  }, [searchResults]);

  // Filter products by price range
  const filteredProducts = useMemo(() => {
    if (!priceFilter) return searchResults;
    
    return searchResults.filter(product => 
      product.price.current >= priceFilter.min && 
      product.price.current <= priceFilter.max
    );
  }, [searchResults, priceFilter]);

  const handlePriceFilterChange = (min: number, max: number) => {
    setPriceFilter({ min, max });
  };

  const handleImageSearch = async (image: File) => {
    console.log('Image search triggered with file:', image.name);
    setIsLoading(true);
    setHasSearched(true);
    
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
      
      setSearchResults(data.products || []);
      setDebugInfo({
        query: `Image: ${image.name}`,
        platforms: ['taobao'],
        response: data,
        timestamp: new Date().toISOString(),
      });
      
      console.log(`Found ${data.products?.length || 0} products from image search`);
    } catch (error) {
      console.error('Image search error:', error);
      setSearchResults([]);
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
    setHasSearched(true);

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
        setSearchResults([]);
        setDebugInfo({
          query,
          platforms: selectedPlatforms,
          response: { error: "API not available" },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const data = await response.json();
      setSearchResults(data.products || []);
      
      // Store debug info
      setDebugInfo({
        query,
        platforms: selectedPlatforms,
        response: data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.log("Search error:", error);
      setSearchResults([]);
      setDebugInfo({
        query,
        platforms: selectedPlatforms,
        response: { error: String(error) },
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8 mt-12">
            <h1 className="text-3xl font-bold text-gray-900">
              Sourcing Assistant
            </h1>
          </div>
          
          <div className="space-y-8 mb-12">
            <SearchBar 
              onSearch={handleSearch} 
              onImageSearch={handleImageSearch}
              isLoading={isLoading} 
            />
          </div>
        </div>

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
                    <p className="text-gray-600">
                      • {selectedProducts.size} {selectedProducts.size === 1 ? 'item' : 'items'} selected
                    </p>
                  )}
                  
                  {proposalProducts.length > 0 && (
                    <p className="text-gray-600">
                      • {proposalProducts.length} items in proposal
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
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
                        disabled={selectedProducts.size === 0}
                        className="bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        Add Selected to Proposal
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
                  marginBottom: isFilterOpen ? 24 : 0,
                }}
                transition={{
                  duration: 0.3,
                  ease: "easeInOut"
                }}
                className="overflow-hidden"
              >
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">Platform</h3>
                      <PlatformSelector
                        selectedPlatforms={selectedPlatforms}
                        onPlatformsChange={setSelectedPlatforms}
                      />
                    </div>
                    
                    <div className="border-t pt-6">
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">Price Range</h3>
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

              <ProductTable 
                products={filteredProducts} 
                onAddToProposal={handleAddToProposal}
                selectedProducts={selectedProducts}
                setSelectedProducts={setSelectedProducts}
              />
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

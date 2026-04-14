"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { SearchBar } from "@/components/search/search-bar";
import { PlatformSelector } from "@/components/search/platform-selector";
import { ProductTable } from "@/components/products/product-table";
import { ProductCardView } from "@/components/products/product-card-view";
import { PriceFilter } from "@/components/filters/price-filter";
import { Platform, ProductDTO } from "@/types/product";
import { Loader2, Package, ShoppingCart, Download, FileJson, FileSpreadsheet, SlidersHorizontal, LayoutGrid, List, X, FolderOpen, FileImage, Play, FolderInput, CheckCircle2, RefreshCw, ArrowUp, ArrowDown } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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
  const [isExistingProposalDialogOpen, setIsExistingProposalDialogOpen] = useState(false);
  const [existingProposals, setExistingProposals] = useState<any[]>([]);
  const [isAddingToExisting, setIsAddingToExisting] = useState(false);
  const [dialogFilterMode, setDialogFilterMode] = useState<'my' | 'all'>('all');
  const [dialogSortField, setDialogSortField] = useState<'name' | 'date'>('date');
  const [dialogSortDir, setDialogSortDir] = useState<'asc' | 'desc'>('desc');
  const [appendSuccess, setAppendSuccess] = useState<{ proposalName: string; count: number; duplicates: number } | null>(null);
  
  // Folder upload state
  const [isProcessingFolder, setIsProcessingFolder] = useState(false);
  const [folderImages, setFolderImages] = useState<File[]>([]);
  const [currentProcessingIndex, setCurrentProcessingIndex] = useState(0);
  const [proposalName, setProposalName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const abortBatchRef = useRef(false);
  const saveTabsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Batch summary report
  const [showBatchSummary, setShowBatchSummary] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);
  const [batchSummary, setBatchSummary] = useState<{
    successful: number;
    failed: { name: string; reason: string; thumbnail?: string }[];
    failedFiles: File[];
    total: number;
    aborted?: boolean;
  } | null>(null);
  
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

    // Load search tabs: prefer sessionStorage (current session), fall back to localStorage (saved)
    const storedTabs = sessionStorage.getItem('searchTabs') || localStorage.getItem('savedSearchTabs');
    const storedActiveTabId = sessionStorage.getItem('activeTabId') || localStorage.getItem('savedActiveTabId');
    const storedSelection = sessionStorage.getItem('selectedProducts') || localStorage.getItem('savedSelectedProducts');
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
    if (storedSelection) {
      setSelectedProducts(new Set(JSON.parse(storedSelection)));
    }
  }, []);

  // Save to localStorage whenever proposalProducts changes
  useEffect(() => {
    if (proposalProducts.length > 0) {
      localStorage.setItem('proposalProducts', JSON.stringify(proposalProducts));
    }
  }, [proposalProducts]);

  // Autosave search tabs: instant to sessionStorage, debounced 1s to localStorage
  useEffect(() => {
    if (searchTabs.length > 0) {
      sessionStorage.setItem('searchTabs', JSON.stringify(searchTabs));
      if (saveTabsTimerRef.current) clearTimeout(saveTabsTimerRef.current);
      saveTabsTimerRef.current = setTimeout(() => {
        const serializable = searchTabs.map(t => ({ ...t, timestamp: t.timestamp.toISOString() }));
        localStorage.setItem('savedSearchTabs', JSON.stringify(serializable));
      }, 1000);
    }
  }, [searchTabs]);

  // Autosave selected products instantly to both storages
  useEffect(() => {
    const json = JSON.stringify([...selectedProducts]);
    sessionStorage.setItem('selectedProducts', json);
    localStorage.setItem('savedSelectedProducts', json);
  }, [selectedProducts]);

  // Autosave active tab ID instantly to both storages
  useEffect(() => {
    if (activeTabId) {
      sessionStorage.setItem('activeTabId', activeTabId);
      localStorage.setItem('savedActiveTabId', activeTabId);
    }
  }, [activeTabId]);

  // ESC key to abort batch image processing
  useEffect(() => {
    if (!isProcessingFolder) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        abortBatchRef.current = true;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProcessingFolder]);

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
    
    // Add product WITHOUT fetching details - details will be fetched when saving proposal
    setProposalProducts([...proposalProducts, product]);
  };

  const openExistingProposalDialog = async () => {
    try {
      const response = await fetch('/api/proposals');
      if (response.ok) {
        const data = await response.json();
        setExistingProposals(data.proposals || []);
      } else {
        setExistingProposals([]);
      }
    } catch {
      setExistingProposals([]);
    }
    setIsExistingProposalDialogOpen(true);
  };

  const handleAddToExistingProposal = async (proposalId: string) => {
    setIsAddingToExisting(true);
    try {
      // Collect all selected products across all tabs (no duplicates)
      const allSelected: any[] = [];
      searchTabs.forEach(tab => {
        tab.products.filter(p => selectedProducts.has(p.id)).forEach(p => {
          if (!allSelected.some(x => x.id === p.id)) allSelected.push(p);
        });
      });

      if (allSelected.length === 0) return;

      const existing = existingProposals.find(p => p.id === proposalId);
      if (!existing) { alert('Proposal not found'); return; }

      const existingIds = new Set((existing.products || []).map((p: any) => p.source_id || p.id));
      const newProducts = allSelected.filter(p => !existingIds.has(p.source_id || p.id));

      if (newProducts.length === 0) {
        alert('All selected items are already in this proposal.');
        return;
      }

      // Await PATCH so we get the server's authoritative added count (after server-side dedup)
      const patchRes = await fetch('/api/proposal-details', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId,
          newProducts,
          proposalName: existing.name,
          clientName: existing.client_name,
          notes: existing.notes,
          status: existing.status,
        }),
      });
      if (!patchRes.ok) {
        const errText = await patchRes.text();
        console.error('PATCH failed:', errText);
        alert('Failed to add items to proposal.');
        return;
      }
      const patchData = await patchRes.json();
      const actualAdded = patchData.added ?? newProducts.length;
      const duplicateCount = allSelected.length - actualAdded;
      setSelectedProducts(new Set());
      setIsExistingProposalDialogOpen(false);
      setAppendSuccess({ proposalName: existing.name, count: actualAdded, duplicates: duplicateCount });
      setTimeout(() => setAppendSuccess(null), 5000);
    } catch (err) {
      console.error('Failed to add to existing proposal:', err);
      alert('Failed to add items to proposal.');
    } finally {
      setIsAddingToExisting(false);
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
      
      // Add products WITHOUT fetching details - details will be fetched when saving proposal
      const productsToAdd = allProducts.filter(
        product => !newProposalProducts.some(p => p.id === product.id)
      );
      
      newProposalProducts.push(...productsToAdd);
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
      limit: parseInt(process.env.NEXT_PUBLIC_SEARCH_RESULT_LIMIT || '50', 10),
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
    
    abortBatchRef.current = false;
    setIsProcessingFolder(true);
    setCurrentProcessingIndex(0);
    setBatchSummary(null);
    
    let successfulCount = 0;
    let wasAborted = false;
    const failedImages: { name: string; reason: string; thumbnail?: string }[] = [];
    const failedFileObjects: File[] = [];
    
    try {
      for (let i = 0; i < folderImages.length; i++) {
        if (abortBatchRef.current) {
          wasAborted = true;
          break;
        }
        
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
            
            if (products.length === 0) {
              failedImages.push({ name: file.name, reason: 'No similar products found', thumbnail: URL.createObjectURL(file) });
              failedFileObjects.push(file);
            } else {
              // Create tab for this image
              const tabLabel = file.name.length > 25 ? file.name.substring(0, 25) + '...' : file.name;
              createNewTab(`Folder: ${tabLabel}`, 'image', products, ['taobao']);
              successfulCount++;
            }
            
            // Add delay to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            let reason = `HTTP ${response.status}`;
            try {
              const errData = await response.json();
              if (errData.error) reason = errData.error;
              else if (errData.detail) reason = errData.detail;
            } catch {}
            // Trim long API doc URLs from error messages
            reason = reason.split(' 接口文档')[0].split(' API文档')[0];
            failedImages.push({ name: file.name, reason, thumbnail: URL.createObjectURL(file) });
            failedFileObjects.push(file);
          }
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error);
          failedImages.push({ name: file.name, reason: 'Network error or request failed', thumbnail: URL.createObjectURL(file) });
          failedFileObjects.push(file);
        }
      }
    } finally {
      setIsProcessingFolder(false);
      setCurrentProcessingIndex(0);
      
      // Show summary if there were any results
      if (failedImages.length > 0 || successfulCount > 0 || wasAborted) {
        setBatchSummary({
          successful: successfulCount,
          failed: failedImages,
          failedFiles: failedFileObjects,
          total: folderImages.length,
          aborted: wasAborted,
        });
        setShowBatchSummary(true);
      }
    }
  };

  const handleRetryFailedImages = async () => {
    if (!batchSummary || batchSummary.failedFiles.length === 0) return;
    
    const filesToRetry = [...batchSummary.failedFiles];
    const prevSuccessful = batchSummary.successful;
    const totalItems = batchSummary.total;
    setShowBatchSummary(false);
    abortBatchRef.current = false;
    setIsProcessingFolder(true);
    setCurrentProcessingIndex(0);
    
    let newSuccessCount = 0;
    const stillFailed: { name: string; reason: string; thumbnail?: string }[] = [];
    const stillFailedFiles: File[] = [];
    
    try {
      for (let i = 0; i < filesToRetry.length; i++) {
        if (abortBatchRef.current) break;
        
        const file = filesToRetry[i];
        setCurrentProcessingIndex(prevSuccessful + i + 1);
        
        try {
          const formData = new FormData();
          formData.append('image', file);
          
          const response = await fetch('/api/search-image', {
            method: 'POST',
            body: formData,
          });
          
          if (response.ok) {
            const data = await response.json();
            const products = data.products || [];
            
            if (products.length === 0) {
              stillFailed.push({ name: file.name, reason: 'No similar products found', thumbnail: URL.createObjectURL(file) });
              stillFailedFiles.push(file);
            } else {
              const tabLabel = file.name.length > 25 ? file.name.substring(0, 25) + '...' : file.name;
              createNewTab(`Folder: ${tabLabel}`, 'image', products, ['taobao']);
              newSuccessCount++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            let reason = `HTTP ${response.status}`;
            try {
              const errData = await response.json();
              if (errData.error) reason = errData.error;
              else if (errData.detail) reason = errData.detail;
            } catch {}
            reason = reason.split(' 接口文档')[0].split(' API文档')[0];
            stillFailed.push({ name: file.name, reason, thumbnail: URL.createObjectURL(file) });
            stillFailedFiles.push(file);
          }
        } catch (error) {
          console.error(`Error retrying ${file.name}:`, error);
          stillFailed.push({ name: file.name, reason: 'Network error or request failed', thumbnail: URL.createObjectURL(file) });
          stillFailedFiles.push(file);
        }
      }
    } finally {
      setIsProcessingFolder(false);
      setCurrentProcessingIndex(0);
      setBatchSummary({
        successful: prevSuccessful + newSuccessCount,
        failed: stillFailed,
        failedFiles: stillFailedFiles,
        total: totalItems,
      });
      setShowBatchSummary(true);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Batch Search Summary Dialog */}
      {showBatchSummary && batchSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Batch Search Summary</h2>
              <button onClick={() => setShowBatchSummary(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Stats row */}
              <div className="flex gap-4">
                <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">{batchSummary.successful}</p>
                  <p className="text-xs text-green-600 mt-1">Successful</p>
                </div>
                <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-700">{batchSummary.failed.length}</p>
                  <p className="text-xs text-red-600 mt-1">Failed</p>
                </div>
                <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-700">{batchSummary.total}</p>
                  <p className="text-xs text-gray-600 mt-1">Total</p>
                </div>
              </div>
              
              {/* Failed images list */}
              {batchSummary.failed.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Failed Images:</h3>
                  <div className="max-h-60 overflow-y-auto space-y-2">
                    {batchSummary.failed.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                        {item.thumbnail ? (
                          <button
                            type="button"
                            onClick={() => setPreviewImage({ src: item.thumbnail!, name: item.name })}
                            className="flex-shrink-0 w-10 h-10 rounded overflow-hidden border border-red-200 hover:border-sky-400 hover:ring-2 hover:ring-sky-300 transition-all cursor-zoom-in"
                            title="Click to view full image"
                          >
                            <img src={item.thumbnail} alt={item.name} className="w-full h-full object-cover" />
                          </button>
                        ) : (
                          <div className="flex-shrink-0 w-10 h-10 bg-red-200 rounded flex items-center justify-center">
                            <X className="h-4 w-4 text-red-700" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate" title={item.name}>{item.name}</p>
                          <p className="text-xs text-red-600 mt-0.5">{item.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-4">
              <div>
                {batchSummary.aborted && (
                  <p className="text-sm text-amber-600 font-medium">⚠ Search was aborted early.</p>
                )}
              </div>
              <div className="flex gap-2">
                {batchSummary.failed.length > 0 && (
                  <Button variant="outline" onClick={handleRetryFailedImages}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry Failed ({batchSummary.failed.length})
                  </Button>
                )}
                <Button onClick={() => { setShowBatchSummary(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Close</Button>
              </div>
            </div>
          </div>
        </div>
      )}
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
                        placeholder="Proposal name (optional)"
                        value={proposalName}
                        onChange={(e) => setProposalName(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                      />
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
                    <span className="text-gray-600">Processing images... <span className="text-gray-400 text-xs">(Press ESC to abort)</span></span>
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
            <div className="flex justify-end items-center gap-3 mb-2">
              <button
                onClick={() => {
                  setSearchTabs([]);
                  setSelectedProducts(new Set());
                  localStorage.removeItem('savedSearchTabs');
                  localStorage.removeItem('savedActiveTabId');
                  localStorage.removeItem('savedSelectedProducts');
                  sessionStorage.removeItem('searchTabs');
                  sessionStorage.removeItem('activeTabId');
                  sessionStorage.removeItem('selectedProducts');
                }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {searchTabs.map((tab) => (
                <motion.div
                  key={tab.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all cursor-pointer min-w-0 ${
                    tab.id === activeTabId
                      ? 'bg-sky-50 border-sky-400 shadow-sm'
                      : 'bg-white border-gray-200 hover:border-sky-300'
                  }`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`text-sm font-medium truncate ${
                      tab.id === activeTabId ? 'text-sky-700' : 'text-gray-700'
                    }`}>
                      {tab.label}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
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
                    className={`flex-shrink-0 hover:bg-gray-200 rounded p-1 transition-colors ${
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
              {appendSuccess && (
                <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-lg bg-green-50 border border-green-300 text-green-800 text-sm">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                  <span>
                    <strong>{appendSuccess.count} item{appendSuccess.count !== 1 ? 's' : ''}</strong> added to <strong>{appendSuccess.proposalName}</strong>
                    {appendSuccess.duplicates > 0 && (
                      <span className="text-green-600"> · {appendSuccess.duplicates} duplicate{appendSuccess.duplicates !== 1 ? 's' : ''} skipped</span>
                    )}. Details are being fetched in the background.
                  </span>
                  <button onClick={() => setAppendSuccess(null)} className="ml-auto text-green-600 hover:text-green-800">✕</button>
                </div>
              )}
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

                      <DropdownMenuItem onClick={openExistingProposalDialog}>
                        <FolderInput className="h-4 w-4 mr-2" />
                        Add to Existing Proposal...
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
    {/* Add to Existing Proposal Dialog */}
    <Dialog open={isExistingProposalDialogOpen} onOpenChange={setIsExistingProposalDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to Existing Proposal</DialogTitle>
          <DialogDescription>
            Select a proposal to add the {selectedProducts.size} selected item{selectedProducts.size !== 1 ? 's' : ''} to.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setDialogFilterMode('my')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                dialogFilterMode === 'my' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              My Proposals
            </button>
            <button
              onClick={() => setDialogFilterMode('all')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                dialogFilterMode === 'all' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              All
            </button>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setDialogSortField('name')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                dialogSortField === 'name' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >Name</button>
            <button
              onClick={() => setDialogSortField('date')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                dialogSortField === 'date' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >Date</button>
            <button
              onClick={() => setDialogSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="px-2 py-1 rounded-md text-gray-600 hover:text-sky-700 transition-colors"
              title={dialogSortDir === 'asc' ? 'Ascending' : 'Descending'}
            >
              {dialogSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            </button>
          </div>
        </div>
        {(() => {
          const userEmail = session?.user?.email;
          const filtered = dialogFilterMode === 'my' && userEmail
            ? existingProposals.filter(p => !p.createdBy || p.createdBy?.email === userEmail)
            : existingProposals;
          const sorted = [...filtered].sort((a, b) => {
            const cmp = dialogSortField === 'name'
              ? (a.name || '').localeCompare(b.name || '')
              : new Date(a.updated_at || a.created_at).getTime() - new Date(b.updated_at || b.created_at).getTime();
            return dialogSortDir === 'asc' ? cmp : -cmp;
          });
          return sorted.length === 0 ? (
          <div className="py-8 text-center text-gray-400">
            <Package className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No proposals found.</p>
          </div>
        ) : (
          <div className="mt-2 max-h-72 overflow-y-auto space-y-2 pr-1">
            {sorted.map(p => (
              <button
                key={p.id}
                disabled={isAddingToExisting}
                onClick={() => handleAddToExistingProposal(p.id)}
                className="w-full text-left flex items-center justify-between px-4 py-3 rounded-lg border border-gray-200 hover:border-sky-400 hover:bg-sky-50 transition-colors disabled:opacity-50"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{p.name}</p>
                  {p.client_name && (
                    <p className="text-xs text-gray-500 truncate">Client: {p.client_name}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className="text-xs text-gray-500">{(p.products?.length ?? p.totalItems ?? 0)} items</span>
                  <Badge
                    variant="outline"
                    className={{
                      draft: 'bg-gray-100 text-gray-600 border-gray-200',
                      submitted: 'bg-blue-100 text-blue-600 border-blue-200',
                      approved: 'bg-green-100 text-green-600 border-green-200',
                      rejected: 'bg-red-100 text-red-600 border-red-200',
                    }[p.status as string] || 'bg-gray-100 text-gray-600 border-gray-200'}
                  >
                    {p.status}
                  </Badge>
                  {isAddingToExisting && (
                    <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
                  )}
                </div>
              </button>
            ))}
          </div>
        );
        })()}
      </DialogContent>
    </Dialog>

      {/* Image preview lightbox */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh] mx-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 z-10 w-7 h-7 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-600 hover:text-gray-900"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={previewImage.src}
              alt={previewImage.name}
              className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain"
            />
            <p className="mt-2 text-center text-sm text-white/80 truncate">{previewImage.name}</p>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { ProductDTO } from "@/types/product";
import { formatCurrency } from "@/lib/utils";
import { ExternalLink, ShoppingCart, ChevronDown, ChevronUp, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageCarouselModal } from "@/components/ui/image-carousel-modal";

interface ProductTableProps {
  products: ProductDTO[];
  onAddToProposal?: (product: ProductDTO) => void;
  onFindSimilar?: (product: ProductDTO) => void;
  findingSimilarFor?: string | null;
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
  // Legacy fields for backward compatibility
  seller?: {
    name: string;
    location: string;
    rating?: number;
  };
  sales_volume?: number;
  description?: string;
}

type SortOrder = 'asc' | 'desc' | null;

export function ProductTable({ products, onAddToProposal, selectedProducts, setSelectedProducts, onFindSimilar, findingSimilarFor }: ProductTableProps & {
  selectedProducts?: Set<string>;
  setSelectedProducts?: (products: Set<string>) => void;
}) {
  const [internalSelectedProducts, setInternalSelectedProducts] = useState<Set<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
  const [productDetails, setProductDetails] = useState<Map<string, ProductDetails>>(new Map());
  const [priceSortOrder, setPriceSortOrder] = useState<SortOrder>(null);
  const [nameSortOrder, setNameSortOrder] = useState<SortOrder>(null);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);
  const [carouselImages, setCarouselImages] = useState<Array<{ url: string }>>([]);
  const [carouselInitialIndex, setCarouselInitialIndex] = useState(0);
  const [isCarouselOpen, setIsCarouselOpen] = useState(false);

  // Use external state if provided, otherwise use internal state
  const activeSelectedProducts = selectedProducts ?? internalSelectedProducts;
  const setActiveSelectedProducts = setSelectedProducts ?? setInternalSelectedProducts;

  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // Sort products based on price or name
  const sortedProducts = useMemo(() => {
    let sorted = [...products];
    
    if (priceSortOrder) {
      sorted.sort((a, b) => {
        const priceA = a.price.current;
        const priceB = b.price.current;
        return priceSortOrder === 'asc' ? priceA - priceB : priceB - priceA;
      });
    } else if (nameSortOrder) {
      sorted.sort((a, b) => {
        const nameA = a.title.toLowerCase();
        const nameB = b.title.toLowerCase();
        return nameSortOrder === 'asc' 
          ? nameA.localeCompare(nameB) 
          : nameB.localeCompare(nameA);
      });
    }
    
    return sorted;
  }, [products, priceSortOrder, nameSortOrder]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept keyboard events when user is typing in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (!tableRef.current?.contains(document.activeElement) && focusedRowIndex === -1) {
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedRowIndex(prev => {
            const newIndex = prev < sortedProducts.length - 1 ? prev + 1 : prev;
            return newIndex;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedRowIndex(prev => {
            const newIndex = prev > 0 ? prev - 1 : 0;
            return newIndex;
          });
          break;
        case ' ':
          e.preventDefault();
          if (focusedRowIndex >= 0 && focusedRowIndex < sortedProducts.length) {
            const product = sortedProducts[focusedRowIndex];
            const newSelected = new Set(activeSelectedProducts);
            if (newSelected.has(product.id)) {
              newSelected.delete(product.id);
            } else {
              newSelected.add(product.id);
            }
            setActiveSelectedProducts(newSelected);
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focusedRowIndex, sortedProducts, activeSelectedProducts, setActiveSelectedProducts]);

  // Focus table on mount to enable keyboard navigation
  useEffect(() => {
    if (tableRef.current && products.length > 0) {
      tableRef.current.focus();
    }
  }, [products]);

  // Auto-scroll focused row into view
  useEffect(() => {
    if (focusedRowIndex >= 0 && focusedRowIndex < sortedProducts.length) {
      const rowElement = rowRefs.current.get(focusedRowIndex);
      if (rowElement) {
        rowElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest'
        });
      }
    }
  }, [focusedRowIndex, sortedProducts.length]);

  const togglePriceSort = () => {
    setNameSortOrder(null); // Clear name sort when sorting by price
    if (priceSortOrder === null) {
      setPriceSortOrder('asc');
    } else if (priceSortOrder === 'asc') {
      setPriceSortOrder('desc');
    } else {
      setPriceSortOrder(null);
    }
  };

  const toggleNameSort = () => {
    setPriceSortOrder(null); // Clear price sort when sorting by name
    if (nameSortOrder === null) {
      setNameSortOrder('asc');
    } else if (nameSortOrder === 'asc') {
      setNameSortOrder('desc');
    } else {
      setNameSortOrder(null);
    }
  };

  const toggleProduct = (productId: string) => {
    const newSelected = new Set(activeSelectedProducts);
    if (newSelected.has(productId)) {
      newSelected.delete(productId);
    } else {
      newSelected.add(productId);
    }
    setActiveSelectedProducts(newSelected);
  };

  const toggleRowExpansion = async (productId: string, product: ProductDTO) => {
    const newExpanded = new Set(expandedRows);
    
    if (newExpanded.has(productId)) {
      newExpanded.delete(productId);
      setExpandedRows(newExpanded);
    } else {
      // Immediately show expanded row
      newExpanded.add(productId);
      setExpandedRows(newExpanded);
      
      // Fetch detailed info if not already loaded
      if (!productDetails.has(productId)) {
        const newLoading = new Set(loadingDetails);
        newLoading.add(productId);
        setLoadingDetails(newLoading);
        
        try {
          const response = await fetch(`/api/product-details?productId=${productId}`);
          
          if (!response.ok) {
            throw new Error('Failed to fetch product details');
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
    }
  };

  const handleAddSelectedToProposal = () => {
    const selected = sortedProducts.filter(p => activeSelectedProducts.has(p.id));
    selected.forEach(product => onAddToProposal?.(product));
    setActiveSelectedProducts(new Set());
  };

  const openImageCarousel = (images: Array<{ url: string }>, initialIndex: number = 0) => {
    setCarouselImages(images);
    setCarouselInitialIndex(initialIndex);
    setIsCarouselOpen(true);
  };

  return (
    <div 
      ref={tableRef}
      tabIndex={0}
      className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      onClick={() => setFocusedRowIndex(0)}
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left w-12 text-xs font-semibold text-gray-700 uppercase tracking-wider">
              </th>
              <th className="px-4 py-3 text-left w-24 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Image
              </th>
              <th className="px-4 py-3 text-left min-w-[300px]">
                <button
                  onClick={toggleNameSort}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-700 uppercase tracking-wider hover:text-sky-600 transition-colors"
                >
                  Product
                  {nameSortOrder === null && <ArrowUpDown className="h-3 w-3" />}
                  {nameSortOrder === 'asc' && <ArrowUp className="h-3 w-3 text-sky-600" />}
                  {nameSortOrder === 'desc' && <ArrowDown className="h-3 w-3 text-sky-600" />}
                </button>
              </th>
              <th className="px-4 py-3 text-left w-32">
                <button
                  onClick={togglePriceSort}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-700 uppercase tracking-wider hover:text-sky-600 transition-colors"
                >
                  Price
                  {priceSortOrder === null && <ArrowUpDown className="h-3 w-3" />}
                  {priceSortOrder === 'asc' && <ArrowUp className="h-3 w-3 text-sky-600" />}
                  {priceSortOrder === 'desc' && <ArrowDown className="h-3 w-3 text-sky-600" />}
                </button>
              </th>
              <th className="px-4 py-3 text-center w-40 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Actions
              </th>
              <th className="px-4 py-3 text-center w-20 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Select
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedProducts.map((product, index) => {
              const isExpanded = expandedRows.has(product.id);
              const isLoadingDetails = loadingDetails.has(product.id);
              const details = productDetails.get(product.id);
              const isFocused = index === focusedRowIndex;
              
              return (
                <React.Fragment key={product.id}>
                  <tr 
                    key={product.id}
                    ref={(el) => {
                      if (el) {
                        rowRefs.current.set(index, el);
                      } else {
                        rowRefs.current.delete(index);
                      }
                    }}
                    className={`transition-colors ${
                      isFocused 
                        ? 'bg-sky-50 ring-2 ring-inset ring-sky-400' 
                        : 'hover:bg-gray-50'
                    }`}
                    onClick={() => setFocusedRowIndex(index)}
                  >
                    <td className="px-4 py-4">
                      <button
                        onClick={() => toggleRowExpansion(product.id, product)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5" />
                        ) : (
                          <ChevronDown className="h-5 w-5" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                        {product.image_urls[0] ? (
                          <button
                            className="w-full h-full cursor-zoom-in"
                            onClick={() => openImageCarousel(product.image_urls.map(u => ({ url: u })), 0)}
                            title="Click to view full size"
                          >
                            <img
                              src={product.image_urls[0]}
                              alt={product.title}
                              className="w-full h-full object-cover hover:brightness-90 transition-all"
                            />
                          </button>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            No image
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <h3 className="font-medium text-gray-900 line-clamp-2">
                          {product.title}
                        </h3>
                        {product.description_short && (
                          <p className="text-sm text-gray-500 line-clamp-2">
                            {product.description_short}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <div className="font-semibold text-sky-600">
                          {formatCurrency(product.price.current, product.price.currency)}
                        </div>
                        {product.price.original && product.price.original > product.price.current && (
                          <div className="text-xs text-gray-500 line-through">
                            {formatCurrency(product.price.original, product.price.currency)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          asChild
                          className="h-7 text-xs capitalize w-full hover:bg-sky-50 hover:text-sky-700"
                        >
                          <a
                            href={product.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-3 w-3 mr-1.5" />
                            {product.source}
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onFindSimilar?.(product)}
                          disabled={findingSimilarFor === product.id}
                          className="h-7 text-xs w-full hover:bg-sky-50 hover:text-sky-700 disabled:opacity-50"
                        >
                          {findingSimilarFor === product.id ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                              Finding...
                            </>
                          ) : (
                            <>
                              <Search className="h-3 w-3 mr-1.5" />
                              Similar
                            </>
                          )}
                        </Button>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={activeSelectedProducts.has(product.id)}
                          onCheckedChange={() => toggleProduct(product.id)}
                          className="h-5 w-5 rounded-full"
                        />
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${product.id}-details`} className="bg-gray-50">
                      <td colSpan={7} className="px-4 py-6">
                        {isLoadingDetails ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-sky-500 mr-2" />
                            <span className="text-gray-600">Loading product details...</span>
                          </div>
                        ) : details ? (
                          <div className="space-y-6">
                            {/* Product Images */}
                            {details.item_imgs && details.item_imgs.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-gray-900 mb-3">Product Images</h4>
                                <div className="flex gap-2 overflow-x-auto">
                                  {details.item_imgs.slice(0, 5).map((img, idx) => (
                                    <button
                                      key={idx}
                                      onClick={() => openImageCarousel(details.item_imgs || [], idx)}
                                      className="h-20 w-20 flex-shrink-0 rounded border border-gray-200 overflow-hidden hover:ring-2 hover:ring-sky-500 transition-all cursor-pointer"
                                    >
                                      <img 
                                        src={img.url.startsWith('//') ? `https:${img.url}` : img.url}
                                        alt={`Product ${idx + 1}`}
                                        className="w-full h-full object-cover"
                                      />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-6">
                              <div>
                                <h4 className="font-semibold text-gray-900 mb-3">Product Information</h4>
                                <dl className="space-y-2 text-sm">
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
                                <h4 className="font-semibold text-gray-900 mb-3">Engagement Metrics</h4>
                                <dl className="space-y-2 text-sm">
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
                                    <dt className="text-gray-600">Rating Grade:</dt>
                                    <dd className="font-medium text-gray-900">
                                      {details.rating_grade || 'N/A'}
                                    </dd>
                                  </div>
                                  <div className="flex justify-between">
                                    <dt className="text-gray-600">Sales Volume:</dt>
                                    <dd className="font-medium text-gray-900">
                                      {details.sales_volume ? `${details.sales_volume.toLocaleString()} sold` : 'N/A'}
                                    </dd>
                                  </div>
                                </dl>
                              </div>
                            </div>

                            {/* Product Properties/Specs */}
                            {details.props && details.props.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-gray-900 mb-3">Product Specifications</h4>
                                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                                  {details.props.map((prop, idx) => (
                                    <div key={idx} className="flex justify-between">
                                      <dt className="text-gray-600">{prop.name}:</dt>
                                      <dd className="font-medium text-gray-900">{prop.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            )}

                            {/* Description */}
                            {details.desc_short && (
                              <div>
                                <h4 className="font-semibold text-gray-900 mb-3">Description</h4>
                                <p className="text-sm text-gray-700">{details.desc_short}</p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-center py-8 text-gray-500">
                            Failed to load product details
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <ImageCarouselModal
        images={carouselImages}
        initialIndex={carouselInitialIndex}
        isOpen={isCarouselOpen}
        onClose={() => setIsCarouselOpen(false)}
      />
    </div>
  );
}

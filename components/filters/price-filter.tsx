"use client";

import { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PriceFilterProps {
  minPrice: number;
  maxPrice: number;
  onFilterChange: (min: number, max: number) => void;
  currency?: string;
}

export function PriceFilter({ minPrice, maxPrice, onFilterChange, currency = "CNY" }: PriceFilterProps) {
  const [priceRange, setPriceRange] = useState<[number, number]>([minPrice, maxPrice]);
  const [minInput, setMinInput] = useState(minPrice.toString());
  const [maxInput, setMaxInput] = useState(maxPrice.toString());

  useEffect(() => {
    setPriceRange([minPrice, maxPrice]);
    setMinInput(minPrice.toString());
    setMaxInput(maxPrice.toString());
  }, [minPrice, maxPrice]);

  const handleSliderChange = (values: number[]) => {
    const [min, max] = values;
    setPriceRange([min, max]);
    setMinInput(min.toString());
    setMaxInput(max.toString());
  };

  const handleSliderCommit = (values: number[]) => {
    const [min, max] = values;
    onFilterChange(min, max);
  };

  const handleMinInputChange = (value: string) => {
    setMinInput(value);
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= minPrice && numValue <= priceRange[1]) {
      setPriceRange([numValue, priceRange[1]]);
      onFilterChange(numValue, priceRange[1]);
    }
  };

  const handleMaxInputChange = (value: string) => {
    setMaxInput(value);
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue <= maxPrice && numValue >= priceRange[0]) {
      setPriceRange([priceRange[0], numValue]);
      onFilterChange(priceRange[0], numValue);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium text-gray-700">Price Range ({currency})</Label>
      </div>
      
      <Slider
        min={minPrice}
        max={maxPrice}
        step={1}
        value={priceRange}
        onValueChange={handleSliderChange}
        onValueCommit={handleSliderCommit}
        className="w-full"
      />
      
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Label htmlFor="min-price" className="text-xs text-gray-600">Min</Label>
          <Input
            id="min-price"
            type="number"
            value={minInput}
            onChange={(e) => handleMinInputChange(e.target.value)}
            className="mt-1"
            min={minPrice}
            max={priceRange[1]}
          />
        </div>
        
        <div className="pt-5 text-gray-400">—</div>
        
        <div className="flex-1">
          <Label htmlFor="max-price" className="text-xs text-gray-600">Max</Label>
          <Input
            id="max-price"
            type="number"
            value={maxInput}
            onChange={(e) => handleMaxInputChange(e.target.value)}
            className="mt-1"
            min={priceRange[0]}
            max={maxPrice}
          />
        </div>
      </div>
      
      <div className="text-xs text-gray-500 text-center">
        {priceRange[0].toFixed(2)} - {priceRange[1].toFixed(2)} {currency}
      </div>
    </div>
  );
}

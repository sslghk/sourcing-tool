import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

export function getPlatformColor(platform: string): string {
  const colors: Record<string, string> = {
    taobao: "bg-orange-100 text-orange-700 border-orange-200",
    "1688": "bg-blue-100 text-blue-700 border-blue-200",
    temu: "bg-purple-100 text-purple-700 border-purple-200",
    amazon: "bg-yellow-100 text-yellow-700 border-yellow-200",
  };
  return colors[platform.toLowerCase()] || "bg-gray-100 text-gray-700 border-gray-200";
}

export function getPlatformBadgeColor(platform: string): string {
  return getPlatformColor(platform);
}

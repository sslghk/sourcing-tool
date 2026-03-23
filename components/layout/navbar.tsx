"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Search, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserMenu } from "@/components/auth/user-menu";

const navItems = [
  { href: "/", label: "Search", icon: Search },
  { href: "/proposals", label: "Proposals", icon: FileText },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-6 left-0 right-0 z-50 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="relative">
          <div className="absolute -inset-0.5 bg-sky-100 rounded-full blur-sm"></div>
          <div className="relative flex items-center justify-between bg-white/95 backdrop-blur-xl border border-gray-200 shadow-lg rounded-full px-6 py-3">
            <Link href="/" className="flex items-center">
              <div className="h-14 relative">
                <Image 
                  src="/logos/ssl-logo.png" 
                  alt="SSL Logo" 
                  width={240} 
                  height={56}
                  className="h-full w-auto object-contain"
                />
              </div>
            </Link>
            <div className="flex items-center gap-2">
            {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "relative px-6 py-3 rounded-full transition-all duration-300 flex items-center gap-2",
                    isActive 
                      ? "text-white" 
                      : "text-gray-600 hover:text-gray-900"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="navbar-pill"
                      className="absolute inset-0 bg-sky-500 rounded-full shadow-md"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <Icon className="h-5 w-5 relative z-10" />
                  <span className="relative z-10 font-medium text-base">{item.label}</span>
                </div>
              </Link>
            );
          })}
            </div>
            <UserMenu />
          </div>
        </div>
      </div>
    </nav>
  );
}

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/layout/navbar";
import { SessionProvider } from "next-auth/react";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Sourcing Assistant - Multi-Platform Product Search",
  description: "Search and compare products across Taobao, 1688, Temu, and Amazon with AI-powered insights",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased bg-gray-50`}>
        <SessionProvider>
          <Navbar />
          <main className="pt-32">
            {children}
          </main>
        </SessionProvider>
      </body>
    </html>
  );
}

'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Suspense } from 'react';

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  let errorMessage = 'An authentication error occurred';
  
  switch (error) {
    case 'CredentialsSignin':
      errorMessage = 'Invalid email or password';
      break;
    case 'SessionRequired':
      errorMessage = 'Please sign in to access this page';
      break;
    default:
      if (error) {
        errorMessage = error;
      }
  }

  return (
    <Card className="shadow-xl border-0">
      <CardHeader className="space-y-1 text-center pb-4">
        <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <AlertCircle className="h-6 w-6 text-red-600" />
        </div>
        <CardTitle className="text-2xl font-bold text-gray-900">
          Authentication Error
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
        
        <div className="flex gap-2">
          <Link href="/auth/login" className="flex-1">
            <Button className="w-full bg-sky-600 hover:bg-sky-700">
              Try Again
            </Button>
          </Link>
          <Link href="/" className="flex-1">
            <Button variant="outline" className="w-full">
              Go Home
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Suspense fallback={<Card className="shadow-xl border-0 p-8">Loading...</Card>}>
          <AuthErrorContent />
        </Suspense>
      </motion.div>
    </div>
  );
}

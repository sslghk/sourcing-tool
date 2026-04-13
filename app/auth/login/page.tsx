'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Lock, Mail, KeyRound } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

type ResetStep = 'idle' | 'request' | 'confirm' | 'done';

export default function LoginPage() {
  const router = useRouter();

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Reset password state
  const [resetStep, setResetStep] = useState<ResetStep>('idle');
  const [resetEmail, setResetEmail] = useState('');
  const [resetPin, setResetPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [devPin, setDevPin] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('Invalid email or password');
      } else {
        router.push('/');
        router.refresh();
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const startCountdown = () => {
    setCountdown(300);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRequestPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', email: resetEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetError(data.error || 'Failed to send PIN');
      } else {
        if (data.devPin) {
          setDevPin(data.devPin);
          setResetPin(data.devPin);
        }
        setResetStep('confirm');
        startCountdown();
      }
    } catch {
      setResetError('Network error. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleConfirmPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match');
      return;
    }
    setResetLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', email: resetEmail, pin: resetPin, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetError(data.error || 'Failed to reset password');
      } else {
        setResetStep('done');
      }
    } catch {
      setResetError('Network error. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  const exitReset = () => {
    setResetStep('idle');
    setResetEmail('');
    setResetPin('');
    setNewPassword('');
    setConfirmPassword('');
    setResetError('');
    setCountdown(0);
  };

  const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <AnimatePresence mode="wait">

          {/* ── Login form ─────────────────────────────────────────── */}
          {resetStep === 'idle' && (
            <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card className="shadow-xl border-0">
                <CardHeader className="space-y-1 text-center pb-8">
                  <div className="mx-auto w-12 h-12 bg-sky-100 rounded-full flex items-center justify-center mb-4">
                    <Lock className="h-6 w-6 text-sky-600" />
                  </div>
                  <CardTitle className="text-2xl font-bold text-gray-900">Welcome Back</CardTitle>
                  <CardDescription className="text-gray-500">
                    Sign in to access your sourcing proposals
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {error && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-gray-700">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="email" type="email" placeholder="admin@example.com"
                          value={email} onChange={e => setEmail(e.target.value)}
                          className="pl-10 h-11" required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="password" className="text-gray-700">Password</Label>
                        <button type="button"
                          onClick={() => { setResetEmail(email); setResetStep('request'); setResetError(''); }}
                          className="text-xs text-sky-600 hover:text-sky-700 hover:underline">
                          Forgot password?
                        </button>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="password" type="password" placeholder="••••••••"
                          value={password} onChange={e => setPassword(e.target.value)}
                          className="pl-10 h-11" required />
                      </div>
                    </div>
                    <Button type="submit" className="w-full h-11 bg-sky-600 hover:bg-sky-700" disabled={isLoading}>
                      {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in...</> : 'Sign In'}
                    </Button>
                  </form>

                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── Step 1: Enter email to request PIN ─────────────────── */}
          {resetStep === 'request' && (
            <motion.div key="request" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
              <Card className="shadow-xl border-0">
                <CardHeader className="space-y-1 text-center pb-6">
                  <div className="mx-auto w-12 h-12 bg-sky-100 rounded-full flex items-center justify-center mb-4">
                    <Mail className="h-6 w-6 text-sky-600" />
                  </div>
                  <CardTitle className="text-2xl font-bold text-gray-900">Reset Password</CardTitle>
                  <CardDescription className="text-gray-500">
                    Enter your email and we&apos;ll send a 6-digit PIN
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {resetError && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{resetError}</AlertDescription>
                    </Alert>
                  )}
                  <form onSubmit={handleRequestPin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reset-email" className="text-gray-700">Email address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="reset-email" type="email" placeholder="you@example.com"
                          value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                          className="pl-10 h-11" required />
                      </div>
                    </div>
                    <Button type="submit" className="w-full h-11 bg-sky-600 hover:bg-sky-700" disabled={resetLoading}>
                      {resetLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending PIN...</> : 'Send PIN'}
                    </Button>
                  </form>
                  <button type="button" onClick={exitReset}
                    className="mt-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mx-auto">
                    <ArrowLeft className="h-4 w-4" /> Back to login
                  </button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── Step 2: Enter PIN + new password ───────────────────── */}
          {resetStep === 'confirm' && (
            <motion.div key="confirm" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
              <Card className="shadow-xl border-0">
                <CardHeader className="space-y-1 text-center pb-6">
                  <div className="mx-auto w-12 h-12 bg-sky-100 rounded-full flex items-center justify-center mb-4">
                    <KeyRound className="h-6 w-6 text-sky-600" />
                  </div>
                  <CardTitle className="text-2xl font-bold text-gray-900">Enter PIN</CardTitle>
                  <CardDescription className="text-gray-500">
                    Check <span className="font-medium text-gray-700">{resetEmail}</span> for your PIN
                  </CardDescription>
                  {countdown > 0 && (
                    <p className="text-xs text-amber-600 font-medium">Expires in {formatCountdown(countdown)}</p>
                  )}
                  {countdown === 0 && (
                    <p className="text-xs text-red-500 font-medium">PIN expired —{' '}
                      <button type="button" className="underline" onClick={() => setResetStep('request')}>resend</button>
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  {devPin && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-800">
                      <strong>Dev mode — SMTP unavailable.</strong> PIN pre-filled: <span className="font-mono font-bold">{devPin}</span>
                    </div>
                  )}
                  {resetError && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{resetError}</AlertDescription>
                    </Alert>
                  )}
                  <form onSubmit={handleConfirmPin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="pin" className="text-gray-700">6-digit PIN</Label>
                      <Input id="pin" type="text" inputMode="numeric" placeholder="123456"
                        maxLength={6} value={resetPin} onChange={e => setResetPin(e.target.value.replace(/\D/g, ''))}
                        className="h-11 text-center text-2xl tracking-widest font-mono" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-password" className="text-gray-700">New password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="new-password" type="password" placeholder="At least 6 characters"
                          value={newPassword} onChange={e => setNewPassword(e.target.value)}
                          className="pl-10 h-11" required minLength={6} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirm-password" className="text-gray-700">Confirm password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="confirm-password" type="password" placeholder="Repeat new password"
                          value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                          className="pl-10 h-11" required />
                      </div>
                    </div>
                    <Button type="submit" className="w-full h-11 bg-sky-600 hover:bg-sky-700"
                      disabled={resetLoading || countdown === 0}>
                      {resetLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Resetting...</> : 'Reset Password'}
                    </Button>
                  </form>
                  <button type="button" onClick={exitReset}
                    className="mt-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mx-auto">
                    <ArrowLeft className="h-4 w-4" /> Back to login
                  </button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── Done ───────────────────────────────────────────────── */}
          {resetStep === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <Card className="shadow-xl border-0">
                <CardContent className="pt-10 pb-8 text-center space-y-4">
                  <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">Password reset!</h2>
                  <p className="text-gray-500 text-sm">Your password has been updated. You can now sign in.</p>
                  <Button className="w-full h-11 bg-sky-600 hover:bg-sky-700" onClick={exitReset}>
                    Back to Login
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

        </AnimatePresence>

      </motion.div>
    </div>
  );
}

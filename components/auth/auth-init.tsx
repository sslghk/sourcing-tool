'use client';

import { useEffect } from 'react';
import { userStore } from '@/lib/auth-store';

export function AuthInit() {
  useEffect(() => {
    // Initialize default user if no users exist
    userStore.initDefaultUser();
  }, []);

  return null;
}

// Edge-compatible auth configuration (no Node.js modules)
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const nextAuthConfig = NextAuth({
  secret: process.env.AUTH_SECRET || 'development-secret-do-not-use-in-production',
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: async (credentials) => {
        // Dynamic import to avoid Edge Runtime issues
        const { userStore } = await import('@/lib/auth-store');
        
        // Initialize default user if no users exist
        await userStore.initDefaultUser();
        
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await userStore.findByEmail(email);
        if (!user) return null;

        const isValid = await userStore.validatePassword(password, user.password);
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  pages: {
    signIn: '/auth/login',
    error: '/auth/error',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnProtected = nextUrl.pathname.startsWith('/proposals') && 
                           !nextUrl.pathname.startsWith('/api');
      
      if (isOnProtected && !isLoggedIn) {
        return false;
      }
      
      return true;
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.sub as string;
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
});

export const { handlers, signIn, signOut, auth } = nextAuthConfig;
export const { GET, POST } = handlers;

import { User } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: User & {
      id: string;
      isAdmin: boolean;
    };
  }

  interface User {
    id: string;
    email: string;
    name?: string | null;
    isAdmin?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sub?: string;
    isAdmin?: boolean;
  }
}

import { User } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: User & {
      id: string;
    };
  }

  interface User {
    id: string;
    email: string;
    name?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sub?: string;
  }
}

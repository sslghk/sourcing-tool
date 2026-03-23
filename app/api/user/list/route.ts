import { NextRequest, NextResponse } from 'next/server';
import { userStore } from '@/lib/auth-store';

export async function GET(request: NextRequest) {
  try {
    console.log('GET /api/user/list called');
    
    // Get session token from cookies - support both NextAuth v4 and v5
    const token = request.cookies.get('next-auth.session-token')?.value || 
                  request.cookies.get('__Secure-next-auth.session-token')?.value ||
                  request.cookies.get('authjs.session-token')?.value ||
                  request.cookies.get('__Secure-authjs.session-token')?.value;
    
    console.log('Token found:', !!token);
    
    if (!token) {
      console.log('No token found');
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get admin email from header
    const adminEmail = request.headers.get('x-user-email');
    console.log('Admin email from header:', adminEmail);
    
    if (!adminEmail) {
      console.log('No admin email in header');
      return NextResponse.json(
        { error: 'User email not provided' },
        { status: 400 }
      );
    }

    // Check if admin
    const admin = await userStore.findByEmail(adminEmail);
    console.log('Admin found:', !!admin);
    
    if (!admin || admin.email !== 'admin@example.com') {
      console.log('Not admin user');
      return NextResponse.json(
        { error: 'Only admin can view user list' },
        { status: 403 }
      );
    }

    // Get all users - we need to read the file directly
    const fs = await import('fs');
    const path = await import('path');
    const USERS_FILE = path.join(process.cwd(), 'data', 'users.json');
    
    console.log('Users file path:', USERS_FILE);
    console.log('File exists:', fs.existsSync(USERS_FILE));
    
    if (!fs.existsSync(USERS_FILE)) {
      console.log('Users file does not exist');
      return NextResponse.json({ users: [] }, { status: 200 });
    }
    
    const usersData = fs.readFileSync(USERS_FILE, 'utf-8');
    const users = JSON.parse(usersData);
    
    console.log('Raw users data:', users);
    
    // Remove passwords from response
    const usersWithoutPasswords = users.map((user: any) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    console.log('Users without passwords:', usersWithoutPasswords);

    return NextResponse.json(
      { users: usersWithoutPasswords },
      { status: 200 }
    );
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json(
      { error: 'Failed to get users' },
      { status: 500 }
    );
  }
}

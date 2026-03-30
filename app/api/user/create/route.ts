import { NextRequest, NextResponse } from 'next/server';
import { userStore } from '@/lib/auth-store';

export async function POST(request: NextRequest) {
  try {
    // Get session token from cookies
    const token = request.cookies.get('next-auth.session-token')?.value || 
                  request.cookies.get('__Secure-next-auth.session-token')?.value ||
                  request.cookies.get('authjs.session-token')?.value ||
                  request.cookies.get('__Secure-authjs.session-token')?.value;
    
    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get admin email from header
    const adminEmail = request.headers.get('x-user-email');
    if (!adminEmail) {
      return NextResponse.json(
        { error: 'User email not provided' },
        { status: 400 }
      );
    }

    // Check if admin (first user or admin@example.com)
    const admin = await userStore.findByEmail(adminEmail);
    if (!admin) {
      return NextResponse.json(
        { error: 'Admin not found' },
        { status: 404 }
      );
    }

    // Only allow admin@example.com to create users for now
    if (admin.email !== 'admin@example.com') {
      return NextResponse.json(
        { error: 'Only admin can create users' },
        { status: 403 }
      );
    }

    const { name, email, password } = await request.json();

    // Validation
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await userStore.findByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password and create user
    const hashedPassword = await userStore.hashPassword(password);
    const newUser = await userStore.create({
      email,
      name,
      password: hashedPassword,
    });

    return NextResponse.json(
      { 
        message: 'User created successfully', 
        user: { 
          id: newUser.id, 
          email: newUser.email, 
          name: newUser.name 
        } 
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('User creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { userStore } from '@/lib/auth-store';

export async function PUT(request: NextRequest) {
  try {
    // Get session token from cookies - support both NextAuth v4 and v5
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

    const { name } = await request.json();

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    // Get email from token by finding user with matching session
    // For JWT strategy, we need to decode the token or use a workaround
    // Since we store user data in JSON file, we'll use a simple approach:
    // Get all users and find by email from a header or query param
    // Actually, let's use a different approach - store email in a custom header from client
    
    // For now, get email from request body or header
    const email = request.headers.get('x-user-email');
    if (!email) {
      return NextResponse.json(
        { error: 'User email not provided' },
        { status: 400 }
      );
    }

    // Find user
    const user = await userStore.findByEmail(email);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Update user profile
    const updatedUser = await userStore.updateProfile(user.id, name);
    if (!updatedUser) {
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: 'Profile updated successfully', user: { name: updatedUser.name } },
      { status: 200 }
    );
  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}

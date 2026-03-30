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

    // Get email from header
    const email = request.headers.get('x-user-email');
    if (!email) {
      return NextResponse.json(
        { error: 'User email not provided' },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current password and new password are required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: 'New password must be at least 6 characters' },
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

    // Verify current password
    const isValid = await userStore.validatePassword(currentPassword, user.password);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 }
      );
    }

    // Update password
    const updated = await userStore.updatePassword(user.id, newPassword);
    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update password' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: 'Password changed successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Password change error:', error);
    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    );
  }
}

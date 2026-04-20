import { NextRequest, NextResponse } from 'next/server';
import { userStore } from '@/lib/auth-store';
import fs from 'fs';
import path from 'path';

const USERS_FILE = path.join(process.cwd(), 'data', 'users.json');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get('next-auth.session-token')?.value ||
                  request.cookies.get('__Secure-next-auth.session-token')?.value ||
                  request.cookies.get('authjs.session-token')?.value ||
                  request.cookies.get('__Secure-authjs.session-token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const adminEmail = request.headers.get('x-user-email');
    if (!adminEmail) {
      return NextResponse.json({ error: 'User email not provided' }, { status: 400 });
    }

    const admin = await userStore.findByEmail(adminEmail);
    if (!admin || !userStore.isAdminUser(admin)) {
      return NextResponse.json({ error: 'Only admin can change user passwords' }, { status: 403 });
    }

    const { id } = await params;
    const { newPassword } = await request.json();

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    if (!fs.existsSync(USERS_FILE)) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    const userIndex = users.findIndex((u: any) => u.id === id);

    if (userIndex === -1) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hashedPassword = await userStore.hashPassword(newPassword);
    users[userIndex].password = hashedPassword;
    users[userIndex].updatedAt = new Date().toISOString();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    return NextResponse.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Admin password change error:', error);
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 });
  }
}

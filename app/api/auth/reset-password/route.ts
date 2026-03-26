import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { userStore } from '@/lib/auth-store';

const PINS_FILE = path.join(process.cwd(), 'data', 'reset-pins.json');
const PIN_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface PinRecord {
  pin: string;
  expiresAt: string;
}

function readPins(): Record<string, PinRecord> {
  if (!fs.existsSync(PINS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PINS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writePins(pins: Record<string, PinRecord>) {
  const dir = path.dirname(PINS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PINS_FILE, JSON.stringify(pins, null, 2));
}

function generatePin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendPinEmail(to: string, pin: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) {
    throw new Error('SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"Sourcing Tool" <${from}>`,
    to,
    subject: 'Your password reset PIN',
    text: `Your password reset PIN is: ${pin}\n\nThis PIN is valid for 5 minutes.\n\nIf you did not request this, please ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2 style="color: #0284c7;">Password Reset</h2>
        <p>Use the PIN below to reset your password. It expires in <strong>5 minutes</strong>.</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; text-align: center;
                    background: #f0f9ff; border: 2px solid #0284c7; border-radius: 8px;
                    padding: 16px; margin: 24px 0; color: #0284c7;">
          ${pin}
        </div>
        <p style="color: #6b7280; font-size: 13px;">If you did not request a password reset, ignore this email.</p>
      </div>
    `,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // ── Step 1: Request PIN ──────────────────────────────────────────────
    if (action === 'request') {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ error: 'Email is required' }, { status: 400 });
      }

      const user = await userStore.findByEmail(email);
      if (!user) {
        // Return success to avoid leaking which emails are registered
        return NextResponse.json({ success: true });
      }

      const pin = generatePin();
      const expiresAt = new Date(Date.now() + PIN_TTL_MS).toISOString();

      const pins = readPins();
      pins[email.toLowerCase()] = { pin, expiresAt };
      writePins(pins);

      const isDev = process.env.NODE_ENV === 'development';
      try {
        await sendPinEmail(email, pin);
        console.log(`Password reset PIN sent to ${email}`);
      } catch (err) {
        console.error('Failed to send reset email:', err);

        if (isDev) {
          // In development, log the PIN to the console so you can test without SMTP
          console.warn(`\n⚠️  SMTP failed — DEV MODE PIN for ${email}: [ ${pin} ]\n`);
          return NextResponse.json({ success: true, devPin: pin, devWarning: 'SMTP unavailable — PIN logged to server console' });
        }

        // Clean up the pin so a retry can be attempted
        delete pins[email.toLowerCase()];
        writePins(pins);
        return NextResponse.json(
          { error: 'Failed to send email. Check SMTP configuration.' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true });
    }

    // ── Step 2: Confirm PIN + set new password ───────────────────────────
    if (action === 'confirm') {
      const { email, pin, newPassword } = body;
      if (!email || !pin || !newPassword) {
        return NextResponse.json({ error: 'Email, PIN, and new password are required' }, { status: 400 });
      }
      if (newPassword.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
      }

      const pins = readPins();
      const record = pins[email.toLowerCase()];

      if (!record) {
        return NextResponse.json({ error: 'No PIN request found for this email' }, { status: 400 });
      }
      if (new Date() > new Date(record.expiresAt)) {
        delete pins[email.toLowerCase()];
        writePins(pins);
        return NextResponse.json({ error: 'PIN has expired. Please request a new one.' }, { status: 400 });
      }
      if (record.pin !== pin) {
        return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 });
      }

      const user = await userStore.findByEmail(email);
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      await userStore.updatePassword(user.id, newPassword);

      // Invalidate PIN after successful use
      delete pins[email.toLowerCase()];
      writePins(pins);

      console.log(`Password reset successful for ${email}`);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

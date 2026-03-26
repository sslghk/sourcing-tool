import { createTransport } from 'nodemailer';

const host = 'mail.simplesymbol.com';
const pass = 'a6y6C4b2';
const from = 'itadmin@simplesymbol.com';

// Try both username formats and common ports
const candidates = [
  { port: 587, secure: false, user: 'itadmin' },
  { port: 587, secure: false, user: 'itadmin@simplesymbol.com' },
  { port: 465, secure: true,  user: 'itadmin' },
  { port: 465, secure: true,  user: 'itadmin@simplesymbol.com' },
  { port: 25,  secure: false, user: 'itadmin' },
];

let successTransporter = null;
let successConfig = null;

for (const cfg of candidates) {
  const label = `port ${cfg.port} / user "${cfg.user}"`;
  process.stdout.write(`Testing ${label} ... `);
  const t = createTransport({
    host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
  try {
    await t.verify();
    console.log('✅ OK');
    successTransporter = t;
    successConfig = cfg;
    break;
  } catch (err) {
    console.log(`❌ ${err.message.split('\n')[0]}`);
  }
}

if (!successTransporter) {
  console.error('\n❌ All SMTP combinations failed. The mail server is not reachable from this machine.');
  console.error('   → The server may only be accessible from inside the company network.');
  process.exit(1);
}

console.log(`\n✅ Connected using port ${successConfig.port}, user "${successConfig.user}"`);
console.log(`Sending test email to ${from} ...`);
try {
  const info = await successTransporter.sendMail({
    from: `"SMTP Test" <${from}>`,
    to: from,
    subject: 'SMTP Test - Sourcing Tool',
    text: 'This is a test email from your Sourcing Tool SMTP configuration.',
  });
  console.log('✅ Email sent! Message ID:', info.messageId);
  console.log(`\nUpdate your .env:\n  SMTP_PORT=${successConfig.port}\n  SMTP_USER=${successConfig.user}`);
} catch (err) {
  console.error('❌ Failed to send email:', err.message);
}

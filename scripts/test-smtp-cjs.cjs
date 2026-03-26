// CommonJS SMTP test — avoids ESM module resolution issues
const nodemailer = require('nodemailer');

const RECIPIENT = 'jacktong@simplesymbol.com';
const HOST = 'mail.simplesymbol.com';
const PASS = 'a6y6C4b2';
const FROM = 'itadmin@simplesymbol.com';

const candidates = [
  { port: 587, secure: false, user: 'itadmin@simplesymbol.com' },
  { port: 587, secure: false, user: 'itadmin' },
  { port: 465, secure: true,  user: 'itadmin@simplesymbol.com' },
  { port: 465, secure: true,  user: 'itadmin' },
  { port: 25,  secure: false, user: 'itadmin@simplesymbol.com' },
];

async function run() {
  let successTransporter = null;
  let successConfig = null;

  for (const cfg of candidates) {
    const label = `port ${cfg.port} / user "${cfg.user}"`;
    process.stdout.write(`Testing ${label} ... `);
    const t = nodemailer.createTransport({
      host: HOST,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: PASS },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });
    try {
      await t.verify();
      console.log('OK');
      successTransporter = t;
      successConfig = cfg;
      break;
    } catch (err) {
      console.log(`FAILED: ${err.message.split('\n')[0]}`);
    }
  }

  if (!successTransporter) {
    console.error('\nAll SMTP combinations failed. Check network access to mail.simplesymbol.com.');
    process.exit(1);
  }

  console.log(`\nConnected: port ${successConfig.port}, user "${successConfig.user}"`);
  console.log(`Sending test email to ${RECIPIENT} ...`);

  const info = await successTransporter.sendMail({
    from: `"Sourcing Tool" <${FROM}>`,
    to: RECIPIENT,
    subject: 'Password Reset Test — Sourcing Tool',
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto">
        <h2 style="color:#0284c7">Password Reset Test</h2>
        <p>This is a test email from the Sourcing Tool password reset configuration.</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;
                    background:#f0f9ff;border:2px solid #0284c7;border-radius:8px;
                    padding:16px;margin:24px 0;color:#0284c7;">
          123456
        </div>
        <p style="color:#6b7280;font-size:13px;">
          SMTP configuration is working correctly.<br>
          Connected via port ${successConfig.port}, user "${successConfig.user}"
        </p>
      </div>
    `,
    text: `Sourcing Tool SMTP test — working via port ${successConfig.port}.`,
  });

  console.log('Email sent! Message ID:', info.messageId);
  console.log(`\nAdd these to .env:\n  SMTP_PORT=${successConfig.port}\n  SMTP_USER=${successConfig.user}\n  SMTP_HOST=mail.simplesymbol.com\n  SMTP_PASS=a6y6C4b2\n  SMTP_FROM=itadmin@simplesymbol.com`);
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

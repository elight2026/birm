/**
 * BIRS NIN Autonomous Verifier - Standalone Node.js Server-Side Proxy
 * 
 * Routes requests to https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate
 * with server-side HTTP headers to completely bypass browser CORS enforcement.
 * 
 * Runs anywhere: Localhost, Render, Railway, Replit, AWS EC2, DigitalOcean, Heroku.
 */

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_GATEWAY = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-MERCHANT-KEY', 'Authorization'] }));
app.use(express.json());

// Health Check
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'BIRS NIN Node.js Server Proxy',
    message: 'Proxy is live and accepting requests from your GitHub Pages frontend',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'BIRS Node.js Proxy', timestamp: new Date().toISOString() });
});

// GET probes for /api/verify to prevent HTTP 405
app.get(['/api/verify', '/api/validate', '/api/proxy'], (_req, res) => {
  res.json({
    status: 'ok',
    service: 'BIRS Node.js Proxy',
    message: 'Proxy is live and ready. Send POST with { "nin": "12345678901" } to verify.',
    gateway: DEFAULT_GATEWAY,
    timestamp: new Date().toISOString()
  });
});

// Verification Proxy Handler
async function handleVerification(req, res) {
  const { nin, merchantKey, gatewayUrl } = req.body || {};
  const cleanedNin = String(nin || '').replace(/\D/g, '');

  if (cleanedNin.length !== 11) {
    return res.status(400).json({
      status: 'failed',
      message: 'Invalid NIN format (must be 11 digits)',
      details: {}
    });
  }

  const targetUrl = gatewayUrl || DEFAULT_GATEWAY;
  const key = (merchantKey || DEFAULT_KEY).trim();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const gatewayRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': key,
        'Origin': 'https://birs.be.gov.ng',
        'Referer': 'https://birs.be.gov.ng/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BIRSProxy/3.0'
      },
      body: JSON.stringify({ nin: cleanedNin }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const text = await gatewayRes.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (gatewayRes.ok && json) {
      return res.status(200).json({
        status: 'success',
        ok: true,
        message: 'Verified successfully via BIRS Live Gateway',
        details: json,
        data: json
      });
    }

    const errorMsg = json?.message || json?.error || `Gateway returned HTTP ${gatewayRes.status}`;
    return res.status(gatewayRes.status >= 400 && gatewayRes.status < 600 ? gatewayRes.status : 500).json({
      status: 'failed',
      ok: false,
      message: errorMsg,
      details: json
    });
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    return res.status(504).json({
      status: 'failed',
      ok: false,
      message: isTimeout ? 'BIRS Gateway request timed out (25s)' : `Network error: ${err.message}`,
      details: {}
    });
  }
}

app.post('/api/verify', handleVerification);
app.post('/api/validate', handleVerification);
app.post('/api/proxy', handleVerification);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[BIRS Proxy] Server running on http://0.0.0.0:${PORT}`);
});

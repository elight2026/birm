/**
 * Vercel Serverless Function - Real BIRS NIN Gateway Proxy
 * Deploys automatically on Vercel to bypass browser CORS completely with zero configuration.
 */

const DEFAULT_GATEWAY = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MERCHANT-KEY');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { nin, merchantKey, gatewayUrl } = req.body || {};
  const cleanedNin = String(nin || '').replace(/\D/g, '');

  if (cleanedNin.length !== 11) {
    return res.status(400).json({
      status: 'failed',
      message: 'Invalid NIN format (must be exactly 11 digits)',
      details: {},
    });
  }

  const targetUrl = gatewayUrl || DEFAULT_GATEWAY;
  const key = (merchantKey || DEFAULT_KEY).trim();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    const bRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': key,
        'Origin': 'https://birs.be.gov.ng',
        'Referer': 'https://birs.be.gov.ng/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
      body: JSON.stringify({ nin: cleanedNin }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await bRes.text();
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {}

    if (bRes.ok && json) {
      return res.status(200).json({
        status: 'success',
        message: 'Verified successfully via Live BIRS Gateway',
        details: json,
        httpStatus: bRes.status,
      });
    }

    const errorMsg = json?.message || json?.error || `Verification failed (HTTP ${bRes.status})`;
    return res.status(bRes.status >= 400 && bRes.status < 600 ? bRes.status : 500).json({
      status: 'failed',
      message: errorMsg,
      details: json,
      httpStatus: bRes.status,
    });
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return res.status(504).json({
      status: 'failed',
      message: isTimeout ? 'Gateway request timed out (25s)' : `Network error: ${err?.message || String(err)}`,
      details: {},
    });
  }
}

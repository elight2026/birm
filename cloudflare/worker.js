/**
 * BIRS NIN Gateway Cloudflare Worker Proxy
 * 
 * Free 100,000 requests/day proxy that forwards requests from any browser
 * to service-gateway.bsg.com.ng with Origin: https://birs.be.gov.ng and adds CORS headers.
 * 
 * Deployment:
 * 1. Log in to dash.cloudflare.com -> Workers & Pages -> Create Application
 * 2. Paste this code and click Deploy.
 * 3. Copy your worker URL (e.g. https://birs-proxy.yourname.workers.dev)
 * 4. Paste it into the BIRS Web App Settings -> Relay Proxy URL!
 */

const DEFAULT_GATEWAY = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-MERCHANT-KEY',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'BIRS Cloudflare Worker Proxy',
        message: 'Proxy is live and active. Send POST with { "nin": "12345678901" } to verify.',
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Use POST' }), {
        status: 405,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json();
      const nin = String(body.nin || '').replace(/\D/g, '');
      const merchantKey = (body.merchantKey || DEFAULT_KEY).trim();
      const gatewayUrl = body.gatewayUrl || DEFAULT_GATEWAY;

      if (nin.length !== 11) {
        return new Response(JSON.stringify({ status: 'failed', message: 'NIN must be 11 digits' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const birsResp = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MERCHANT-KEY': merchantKey,
          'Origin': 'https://birs.be.gov.ng',
          'Referer': 'https://birs.be.gov.ng/',
          'User-Agent': 'Mozilla/5.0 BIRSProxy/1.0',
        },
        body: JSON.stringify({ nin }),
      });

      const data = await birsResp.text();
      return new Response(data, {
        status: birsResp.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ status: 'failed', message: err.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};

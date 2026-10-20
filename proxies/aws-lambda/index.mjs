/**
 * AWS Lambda Function URL / API Gateway Handler
 * Deploy as an AWS Lambda function with Function URL enabled (Auth: NONE, CORS: enabled).
 */

const DEFAULT_GATEWAY = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-MERCHANT-KEY, Authorization',
};

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || 'POST';

  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  let body = {};
  try {
    body = event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {};
  } catch {
    body = {};
  }

  const cleanedNin = String(body.nin || '').replace(/\D/g, '');
  if (cleanedNin.length !== 11) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed', message: 'NIN must be 11 digits', details: {} }),
    };
  }

  const targetUrl = body.gatewayUrl || DEFAULT_GATEWAY;
  const merchantKey = (body.merchantKey || DEFAULT_KEY).trim();

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': merchantKey,
        'Origin': 'https://birs.be.gov.ng',
        'Referer': 'https://birs.be.gov.ng/',
        'User-Agent': 'Mozilla/5.0 AWS-Lambda-Proxy/1.0',
      },
      body: JSON.stringify({ nin: cleanedNin }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'success',
          ok: true,
          message: 'Verified successfully via Live BIRS Gateway',
          details: data,
          data: data,
        }),
      };
    }

    return {
      statusCode: res.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'failed',
        ok: false,
        message: data.message || `Gateway returned HTTP ${res.status}`,
        details: data,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed', message: err.message, details: {} }),
    };
  }
};

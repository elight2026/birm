import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const DEFAULT_GATEWAY_URL = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_MERCHANT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

// CORS & iFrame Friendly Headers
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MERCHANT-KEY');
  next();
});

// Deterministic realistic Nigerian taxpayer generator for sandbox/testing
export function generateMockTaxpayer(nin: string): Record<string, any> {
  const firstNames = ['Adebayo', 'Chioma', 'Musa', 'Amina', 'Chukwuemeka', 'Fatima', 'Babatunde', 'Ngozi', 'Ibrahim', 'Zainab', 'Oche', 'Dooshima'];
  const surnames = ['Okon', 'Danladi', 'Bello', 'Alabi', 'Eze', 'Abubakar', 'Audu', 'Agbo', 'Terkura', 'Orngu', 'Umar', 'Gbande'];
  const middleNames = ['James', 'Grace', 'David', 'Blessing', 'Seun', 'Hassan', 'Emmanuel', 'Kemi', 'Ochoche', 'Saheed', 'Kator', 'Aondo'];
  const lgas = ['Makurdi', 'Gboko', 'Otukpo', 'Gwer East', 'Vandeikya', 'Katsina-Ala', 'Oju', 'Konshisha', 'Ushongo', 'Guma'];

  let hash = 0;
  for (let i = 0; i < nin.length; i++) {
    hash = Math.imul(hash, 31) + nin.charCodeAt(i);
  }
  const posHash = Math.abs(hash);

  const fn = firstNames[posHash % firstNames.length];
  const sn = surnames[Math.floor(posHash / 7) % surnames.length];
  const mn = middleNames[Math.floor(posHash / 13) % middleNames.length];
  const lga = lgas[Math.floor(posHash / 19) % lgas.length];
  const year = 1972 + (posHash % 33);
  const month = String(1 + (posHash % 12)).padStart(2, '0');
  const day = String(1 + (posHash % 28)).padStart(2, '0');
  const gender = posHash % 2 === 0 ? 'Male' : 'Female';
  const phone = '080' + String(10000000 + (posHash % 89999999)).slice(0, 8);

  return {
    'NIN': nin,
    'First Name': fn,
    'Surname': sn,
    'Middle Name': mn,
    'Date of Birth': `${day}/${month}/${year}`,
    'Gender': gender,
    'Mobile': phone,
    'State of Origin': 'Benue State',
    'LGA of Origin': lga,
    'Taxpayer ID (TIN)': `BIRS-TIN-${year}-${nin.slice(-4)}`,
    'Tracking ID': `TRK-${posHash.toString(36).toUpperCase()}`,
    'Residential Address': `No. ${(posHash % 120) + 1} High Level Road, ${lga}, Benue State`,
    'Verification Source': 'BIRS Identity Gateway (Validated)',
  };
}

// Data types
export interface VerificationResult {
  nin: string;
  status: 'success' | 'failed';
  message: string;
  details: Record<string, any>;
  verifiedAt: string;
  attempts: number;
  durationMs: number;
}

export interface BotLog {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  nin?: string;
}

export interface BotJob {
  id: string;
  name: string;
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  totalNins: number;
  queue: string[];
  inFlight: string[];
  results: VerificationResult[];
  logs: BotLog[];
  settings: {
    delayMs: number;
    jitterMs: number;
    concurrency: number;
    maxRetries: number;
    timeoutMs: number;
    merchantKey: string;
    gatewayUrl: string;
    autoRetry: boolean;
    isDemo: boolean;
  };
  stats: {
    total: number;
    processed: number;
    success: number;
    failed: number;
    retries: number;
    avgTimeMs: number;
  };
}

// In-memory store for jobs
const jobs: Map<string, BotJob> = new Map();
const activeJobWorkers: Map<string, { abortController: AbortController }> = new Map();
const sseClients: Map<string, Set<Response>> = new Map();

// Helper to broadcast SSE event
function broadcastJobUpdate(jobId: string, event: string, data: any) {
  const clients = sseClients.get(jobId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

function addLog(job: BotJob, level: BotLog['level'], message: string, nin?: string) {
  const log: BotLog = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toISOString(),
    level,
    message,
    nin,
  };
  job.logs.push(log);
  if (job.logs.length > 500) {
    job.logs.shift(); // keep last 500 logs in memory
  }
  broadcastJobUpdate(job.id, 'log', log);
}

// Helper: Flatten JSON payload
function prettifyKey(k: string): string {
  const specials: Record<string, string> = {
    nin: 'NIN',
    dob: 'Date of Birth',
    dateofbirth: 'Date of Birth',
    firstname: 'First Name',
    surname: 'Surname',
    middlename: 'Middle Name',
    trackingid: 'Tracking ID',
  };
  const lower = String(k).toLowerCase().replace(/[^a-z]/g, '');
  if (specials[lower]) return specials[lower];
  return String(k)
    .replace(/[_.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function flattenJson(json: any, prefix = '', out: Record<string, any> = {}, depth = 0): Record<string, any> {
  if (!json || typeof json !== 'object' || depth > 4) return out;
  for (const k of Object.keys(json)) {
    const v = json[k];
    const key = prefix ? `${prefix} ${prettifyKey(k)}` : prettifyKey(k);
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length && (typeof v[0] === 'string' || typeof v[0] === 'number')) {
        out[key] = v.join(', ');
      } else if (v.length && typeof v[0] === 'object') {
        flattenJson(v[0], key, out, depth + 1);
      }
    } else if (typeof v === 'object') {
      flattenJson(v, key, out, depth + 1);
    } else {
      const sv = String(v).trim();
      if (sv !== '' && sv.length <= 500) {
        out[key] = sv;
      }
    }
    if (Object.keys(out).length > 80) break;
  }
  return out;
}

function extractErrorMessage(json: any, httpStatus: number): string {
  let msg = '';
  if (json && typeof json === 'object') {
    if (typeof json.message === 'string') msg = json.message;
    else if (typeof json.error === 'string') msg = json.error;
    else if (typeof json.errorDescription === 'string') msg = json.errorDescription;
  }
  const inner = msg.match(/"error"\s*:\s*"([^"]+)"/);
  if (inner) msg = inner[1];
  else {
    const m2 = msg.match(/"(?:message|reason)"\s*:\s*"([^"]+)"/);
    if (m2) msg = m2[1];
  }
  msg = (msg || '').trim();
  if (!msg) msg = `Verification failed (HTTP ${httpStatus}).`;
  if (msg.length > 250) msg = msg.slice(0, 250);
  return msg;
}

// Core single NIN verification worker
export async function verifySingleNin(
  nin: string,
  options: {
    merchantKey?: string;
    gatewayUrl?: string;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
    isDemo?: boolean;
  } = {}
): Promise<{ status: 'success' | 'failed'; message: string; details: Record<string, any>; httpStatus?: number }> {
  const cleanedNin = String(nin).replace(/\D/g, '');
  if (cleanedNin.length !== 11) {
    return {
      status: 'failed',
      message: 'Invalid NIN format (must be exactly 11 digits)',
      details: {},
    };
  }

  // Support Sandbox / Simulation Mode for testing & demonstrations
  if (options.isDemo) {
    // Realistic micro-delay (150ms-350ms)
    await new Promise((r) => setTimeout(r, 150 + Math.floor(Math.random() * 200)));
    return {
      status: 'success',
      message: 'Verified successfully (Sandbox / Demo Mode)',
      details: generateMockTaxpayer(cleanedNin),
      httpStatus: 200,
    };
  }

  const url = options.gatewayUrl || DEFAULT_GATEWAY_URL;
  const merchantKey = options.merchantKey || DEFAULT_MERCHANT_KEY;
  const timeoutMs = options.timeoutMs || 25000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Link signals
  const onParentAbort = () => controller.abort();
  if (options.abortSignal) {
    options.abortSignal.addEventListener('abort', onParentAbort);
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': merchantKey,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Origin': 'https://birs.be.gov.ng',
        'Referer': 'https://birs.be.gov.ng/',
        'Accept': 'application/json, text/plain, */*',
      },
      body: JSON.stringify({ nin: cleanedNin }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (options.abortSignal) {
      options.abortSignal.removeEventListener('abort', onParentAbort);
    }

    let json: any = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // body not json
      }
    }

    if (res.ok && json) {
      const details = flattenJson(json);
      if (!details['NIN']) {
        details['NIN'] = cleanedNin;
      }
      return {
        status: 'success',
        message: 'Verified successfully',
        details,
        httpStatus: res.status,
      };
    }

    const errorMsg = extractErrorMessage(json, res.status);
    return {
      status: 'failed',
      message: errorMsg,
      details: json && typeof json === 'object' ? json : {},
      httpStatus: res.status,
    };
  } catch (err: any) {
    clearTimeout(timer);
    if (options.abortSignal) {
      options.abortSignal.removeEventListener('abort', onParentAbort);
    }
    const isTimeout = err?.name === 'AbortError' || err?.message?.includes('aborted');
    return {
      status: 'failed',
      message: isTimeout ? 'Portal request timed out (25s)' : `Network error: ${err?.message || String(err)}`,
      details: {},
    };
  }
}

// Background Bot Engine Runner
async function runBotJobWorker(job: BotJob) {
  const abortController = new AbortController();
  activeJobWorkers.set(job.id, { abortController });

  job.status = 'running';
  job.startedAt = new Date().toISOString();
  addLog(job, 'info', `Bot worker started autonomously for batch "${job.name}" (${job.queue.length} items)`);
  broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    while (job.queue.length > 0) {
      if ((job.status as string) === 'paused') {
        addLog(job, 'warn', 'Bot execution paused by user. Standing by...');
        broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });
        while ((job.status as string) === 'paused') {
          if (abortController.signal.aborted) break;
          await sleep(1000);
        }
        if ((job.status as string) === 'running') {
          addLog(job, 'info', 'Bot execution resumed.');
        }
      }

      if ((job.status as string) === 'stopped' || abortController.signal.aborted) {
        addLog(job, 'warn', 'Bot worker stopped.');
        break;
      }

      const nin = job.queue.shift();
      if (!nin) break;

      job.inFlight = [nin];
      broadcastJobUpdate(job.id, 'inFlight', { inFlight: job.inFlight, remaining: job.queue.length });

      let attempts = 0;
      let lastResult: any = null;
      let success = false;
      const startTime = Date.now();

      while (attempts <= (job.settings.autoRetry ? job.settings.maxRetries : 0)) {
        if ((job.status as string) === 'stopped' || abortController.signal.aborted) break;
        attempts++;

        addLog(job, 'info', `[${job.stats.processed + 1}/${job.totalNins}] Verifying NIN: ${nin} (Attempt ${attempts})`, nin);

        const res = await verifySingleNin(nin, {
          merchantKey: job.settings.merchantKey,
          gatewayUrl: job.settings.gatewayUrl,
          timeoutMs: job.settings.timeoutMs,
          abortSignal: abortController.signal,
          isDemo: job.settings.isDemo,
        });

        lastResult = res;

        if (res.status === 'success') {
          success = true;
          const namePreview = [res.details['First Name'], res.details['Surname']].filter(Boolean).join(' ') || 'Taxpayer';
          addLog(job, 'success', `SUCCESS: Verified ${nin} -> ${namePreview}`, nin);
          break;
        }

        // Check if rate limited or timeout, back off and retry
        const isNotFound = res.message.toLowerCase().includes('not found') || res.message.toLowerCase().includes('invalid');
        const isRateLimit = !isNotFound && (res.httpStatus === 429 || res.message.toLowerCase().includes('rate') || res.message.toLowerCase().includes('too many'));
        const isTimeout = !isNotFound && (res.message.toLowerCase().includes('timed out') || res.message.toLowerCase().includes('timeout'));
        const isServerError = !isNotFound && Boolean(res.httpStatus && res.httpStatus >= 500);

        if ((isRateLimit || isTimeout || isServerError) && attempts <= job.settings.maxRetries && job.settings.autoRetry) {
          const backoffMs = Math.min(10000, 2000 * Math.pow(1.5, attempts));
          addLog(job, 'warn', `Portal returned "${res.message}" for ${nin}. Retrying in ${(backoffMs / 1000).toFixed(1)}s...`, nin);
          job.stats.retries++;
          await sleep(backoffMs);
        } else {
          // Normal failure (e.g. NIN Not Found)
          addLog(job, 'error', `FAILED: ${nin} -> ${res.message}`, nin);
          break;
        }
      }

      const durationMs = Date.now() - startTime;
      const resultObj: VerificationResult = {
        nin,
        status: success ? 'success' : 'failed',
        message: lastResult?.message || 'Verification terminated',
        details: lastResult?.details || {},
        verifiedAt: new Date().toISOString(),
        attempts,
        durationMs,
      };

      job.results.push(resultObj);
      job.stats.processed++;
      if (success) {
        job.stats.success++;
      } else {
        job.stats.failed++;
      }

      // update moving average duration
      job.stats.avgTimeMs = Math.round(
        (job.stats.avgTimeMs * (job.stats.processed - 1) + durationMs) / job.stats.processed
      );

      job.inFlight = [];
      broadcastJobUpdate(job.id, 'result', { result: resultObj, stats: job.stats, remaining: job.queue.length });

      // Apply delay & jitter between requests to respect portal load
      if (job.queue.length > 0 && (job.status as string) === 'running') {
        const jitter = job.settings.jitterMs > 0 ? Math.floor(Math.random() * job.settings.jitterMs) : 0;
        const totalWait = job.settings.delayMs + jitter;
        await sleep(totalWait);
      }
    }

    if (job.queue.length === 0 && (job.status as string) !== 'stopped') {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      addLog(job, 'success', `Job finished: ${job.stats.success} verified, ${job.stats.failed} failed out of ${job.totalNins} total.`);
    }
  } catch (err: any) {
    if (!abortController.signal.aborted) {
      job.status = 'failed';
      addLog(job, 'error', `Worker encountered critical error: ${err?.message || String(err)}`);
    }
  } finally {
    job.inFlight = [];
    activeJobWorkers.delete(job.id);
    broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });
  }
}

// ---------------------- API ROUTES ---------------------- //

// 1. Instant Single NIN Verification
app.post('/api/verify', async (req: Request, res: Response) => {
  const { nin, merchantKey, gatewayUrl, timeoutMs, isDemo } = req.body;
  if (!nin) {
    res.status(400).json({ error: 'NIN is required' });
    return;
  }
  const result = await verifySingleNin(String(nin), {
    merchantKey,
    gatewayUrl,
    timeoutMs,
    isDemo: Boolean(isDemo),
  });
  res.json(result);
});

// 2. Start Autonomous Bot Job
app.post('/api/bot/jobs', (req: Request, res: Response) => {
  const {
    nins,
    name,
    delayMs = 2500,
    jitterMs = 500,
    concurrency = 1,
    maxRetries = 2,
    merchantKey = DEFAULT_MERCHANT_KEY,
    gatewayUrl = DEFAULT_GATEWAY_URL,
    autoRetry = true,
    isDemo = false,
  } = req.body;

  if (!Array.isArray(nins) || nins.length === 0) {
    res.status(400).json({ error: 'Array of NINs is required' });
    return;
  }

  // Filter unique valid 11 digit numbers
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const item of nins) {
    const d = String(item).replace(/\D/g, '');
    if (d.length === 11 && !seen.has(d)) {
      seen.add(d);
      cleaned.push(d);
    }
  }

  if (cleaned.length === 0) {
    res.status(400).json({ error: 'No valid 11-digit NINs found in request' });
    return;
  }

  const jobId = 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const job: BotJob = {
    id: jobId,
    name: name || `Batch ${new Date().toLocaleTimeString()} (${cleaned.length} NINs)`,
    status: 'running',
    createdAt: new Date().toISOString(),
    totalNins: cleaned.length,
    queue: [...cleaned],
    inFlight: [],
    results: [],
    logs: [],
    settings: {
      delayMs: Math.max(500, Number(delayMs) || 2500),
      jitterMs: Math.max(0, Number(jitterMs) || 500),
      concurrency: Math.max(1, Math.min(3, Number(concurrency) || 1)),
      maxRetries: Math.max(0, Number(maxRetries) || 2),
      timeoutMs: 25000,
      merchantKey: String(merchantKey || DEFAULT_MERCHANT_KEY).trim(),
      gatewayUrl: String(gatewayUrl || DEFAULT_GATEWAY_URL).trim(),
      autoRetry: autoRetry !== false,
      isDemo: Boolean(isDemo),
    },
    stats: {
      total: cleaned.length,
      processed: 0,
      success: 0,
      failed: 0,
      retries: 0,
      avgTimeMs: 0,
    },
  };

  jobs.set(jobId, job);

  // Launch autonomous worker in background
  runBotJobWorker(job);

  res.status(201).json({
    ok: true,
    jobId,
    job: {
      id: job.id,
      name: job.name,
      status: job.status,
      totalNins: job.totalNins,
      createdAt: job.createdAt,
      stats: job.stats,
    },
  });
});

// 3. List all jobs
app.get('/api/bot/jobs', (_req: Request, res: Response) => {
  const list = Array.from(jobs.values()).map((j) => ({
    id: j.id,
    name: j.name,
    status: j.status,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    completedAt: j.completedAt,
    totalNins: j.totalNins,
    stats: j.stats,
    inFlight: j.inFlight,
    remaining: j.queue.length,
  }));
  res.json({ jobs: list.reverse() });
});

// 4. Get specific job details
app.get('/api/bot/jobs/:id', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({ job });
});

// 5. Control job: Pause
app.post('/api/bot/jobs/:id/pause', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.status === 'running') {
    job.status = 'paused';
    addLog(job, 'info', 'Job paused by user');
    broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });
  }
  res.json({ ok: true, status: job.status });
});

// 6. Control job: Resume
app.post('/api/bot/jobs/:id/resume', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.status === 'paused') {
    job.status = 'running';
    addLog(job, 'info', 'Job resumed by user');
    broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });
  } else if (job.status === 'stopped' && job.queue.length > 0) {
    runBotJobWorker(job);
  }
  res.json({ ok: true, status: job.status });
});

// 7. Control job: Stop
app.post('/api/bot/jobs/:id/stop', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  job.status = 'stopped';
  const worker = activeJobWorkers.get(job.id);
  if (worker) {
    worker.abortController.abort();
    activeJobWorkers.delete(job.id);
  }
  addLog(job, 'warn', 'Job stopped by user');
  broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });
  res.json({ ok: true, status: job.status });
});

// 8. Retry failed NINs
app.post('/api/bot/jobs/:id/retry-failed', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const failedNins = job.results.filter((r) => r.status === 'failed').map((r) => r.nin);
  if (failedNins.length === 0) {
    res.status(400).json({ error: 'No failed NINs to retry' });
    return;
  }

  // Remove failed results so they can be re-tested
  job.results = job.results.filter((r) => r.status !== 'failed');
  job.queue.push(...failedNins);
  job.stats.failed = 0;
  job.stats.processed = job.results.length;

  addLog(job, 'info', `Re-enqueued ${failedNins.length} failed NINs for retry.`);

  if (job.status !== 'running') {
    runBotJobWorker(job);
  }

  res.json({ ok: true, retryingCount: failedNins.length });
});

// 9. Real-time SSE Stream
app.get('/api/bot/jobs/:id/stream', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  if (!sseClients.has(job.id)) {
    sseClients.set(job.id, new Set());
  }
  sseClients.get(job.id)!.add(res);

  // Send initial snapshot
  res.write(`event: snapshot\ndata: ${JSON.stringify({
    status: job.status,
    stats: job.stats,
    inFlight: job.inFlight,
    remaining: job.queue.length,
    resultsCount: job.results.length,
  })}\n\n`);

  const keepAliveTimer = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAliveTimer);
    }
  }, 10000);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    const clients = sseClients.get(job.id);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(job.id);
      }
    }
  });
});

// 10. Export results to Excel (.xlsx) / CSV / JSON
app.get('/api/bot/jobs/:id/export', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const format = String(req.query.format || 'xlsx').toLowerCase();
  const filter = String(req.query.filter || 'all').toLowerCase();

  let targetResults = job.results;
  if (filter === 'success') {
    targetResults = job.results.filter((r) => r.status === 'success');
  } else if (filter === 'failed') {
    targetResults = job.results.filter((r) => r.status === 'failed');
  }

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="BIRS_NIN_${job.id}_${filter}.json"`);
    res.send(JSON.stringify(targetResults, null, 2));
    return;
  }

  // Create Excel workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: Successful / Detailed records
  const successes = job.results.filter((r) => r.status === 'success');
  const keySet = new Set<string>();
  successes.forEach((r) => {
    Object.keys(r.details || {}).forEach((k) => keySet.add(k));
  });
  const detailKeys = Array.from(keySet).filter((k) => k !== 'NIN');

  const successRows = successes.map((r) => {
    const row: Record<string, any> = {
      'NIN': r.nin,
      'Portal Status': r.message,
      'Verified At': r.verifiedAt,
    };
    for (const k of detailKeys) {
      row[k] = r.details[k] || '';
    }
    return row;
  });

  const wsSuccess = XLSX.utils.json_to_sheet(
    successRows.length > 0 ? successRows : [{ 'NIN': '', 'Portal Status': 'No successful records' }]
  );
  XLSX.utils.book_append_sheet(wb, wsSuccess, 'Verified Taxpayers');

  // Sheet 2: All Results
  const allRows = job.results.map((r) => ({
    'NIN': r.nin,
    'Status': r.status.toUpperCase(),
    'Message': r.message,
    'Verified At': r.verifiedAt,
    'Attempts': r.attempts,
    'Duration (ms)': r.durationMs,
    'Details (Raw)': Object.keys(r.details).length ? JSON.stringify(r.details) : '',
  }));
  const wsAll = XLSX.utils.json_to_sheet(allRows.length > 0 ? allRows : [{ 'NIN': '', 'Status': 'No records' }]);
  XLSX.utils.book_append_sheet(wb, wsAll, 'All Results');

  // Sheet 3: Execution Summary & Stats
  const summaryRows = [
    { Metric: 'Batch Name', Value: job.name },
    { Metric: 'Created At', Value: job.createdAt },
    { Metric: 'Total Input NINs', Value: job.totalNins },
    { Metric: 'Total Processed', Value: job.stats.processed },
    { Metric: 'Successful Validations', Value: job.stats.success },
    { Metric: 'Failed Validations', Value: job.stats.failed },
    { Metric: 'Total Retry Cycles', Value: job.stats.retries },
    { Metric: 'Average Time per NIN (ms)', Value: job.stats.avgTimeMs },
    { Metric: 'Current Status', Value: job.status.toUpperCase() },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary Stats');

  if (format === 'csv') {
    const csvData = XLSX.utils.sheet_to_csv(filter === 'success' ? wsSuccess : wsAll);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="BIRS_NIN_${job.id}_${filter}.csv"`);
    res.send(csvData);
    return;
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="BIRS_NIN_${job.id}_${filter}.xlsx"`);
  res.send(buf);
});

// 11. Download Packaged Autonomous Chrome Extension (.zip)
app.get('/api/extension/download', async (_req: Request, res: Response) => {
  try {
    const zip = new JSZip();

    // 1. Manifest V3
    const manifest = {
      manifest_version: 3,
      name: "BIRS NIN Bulk Verifier & Bot",
      version: "2.1.0",
      description: "Autonomous bulk verification of Nigerian National Identification Numbers (NIN) against the BIRS taxpayer portal.",
      permissions: ["activeTab", "scripting", "storage", "alarms"],
      host_permissions: [
        "*://birs.be.gov.ng/*",
        "*://service-gateway.bsg.com.ng/*"
      ],
      background: {
        service_worker: "background.js"
      },
      action: {
        default_popup: "popup.html",
        default_title: "BIRS NIN Bulk Verifier Bot"
      },
      icons: {
        "16": "icon16.png",
        "48": "icon48.png",
        "128": "icon128.png"
      },
      content_scripts: [
        {
          matches: ["*://birs.be.gov.ng/*"],
          js: ["content.js"],
          run_at: "document_idle"
        }
      ]
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    // 2. Background service worker (Autonomous runner)
    const backgroundJs = `// BIRS NIN Autonomous Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('BIRS NIN Bulk Verifier Bot installed');
});

// Handle keep-alive alarms or autonomous jobs
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'birs_bot_heartbeat') {
    chrome.storage.local.get(['ninBulkVerifierState'], (res) => {
      const state = res.ninBulkVerifierState;
      if (state && state.running) {
        console.log('Bot running autonomously in background, queue size:', state.queue ? state.queue.length : 0);
      }
    });
  }
});

// Set recurring heartbeat alarm every 1 minute
chrome.alarms.create('birs_bot_heartbeat', { periodInMinutes: 1 });
`;
    zip.file("background.js", backgroundJs);

    // 3. Content Script (with auto-retry, autonomous overlay, and robust error handling)
    const contentJs = `/* BIRS NIN Bulk Verifier - Content Script v2.1 (Autonomous Engine) */
(function () {
  'use strict';
  if (window.__ninBulkVerifierLoaded) return;
  window.__ninBulkVerifierLoaded = true;

  const STORE_KEY = 'ninBulkVerifierState';
  const API_URL = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
  const MERCHANT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

  function defaultState() {
    return {
      running: false,
      queue: [],
      total: 0,
      current: null,
      results: [],
      delayMs: 2500,
      timeoutMs: 25000,
      maxRetries: 2,
      reloadBetween: false, // In v2.1 direct API doesn't require reload!
      startedAt: null,
      finished: false
    };
  }

  let state = defaultState();
  let stateReady = false;

  function saveState() {
    const o = {};
    o[STORE_KEY] = state;
    return chrome.storage.local.set(o).catch(() => {});
  }

  function loadState() {
    return chrome.storage.local.get(STORE_KEY).then((o) => {
      if (o && o[STORE_KEY]) state = o[STORE_KEY];
      stateReady = true;
    }).catch(() => { stateReady = true; });
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function extractErrorMessage(json, httpStatus) {
    let msg = '';
    if (json && typeof json === 'object') {
      if (typeof json.message === 'string') msg = json.message;
      else if (typeof json.error === 'string') msg = json.error;
    }
    const inner = msg.match(/"error"\\s*:\\s*"([^"]+)"/);
    if (inner) msg = inner[1];
    msg = (msg || '').trim();
    if (!msg) msg = 'Verification failed (HTTP ' + httpStatus + ')';
    return msg;
  }

  async function verifyOne(nin) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), state.timeoutMs || 25000);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MERCHANT-KEY': MERCHANT_KEY
        },
        body: JSON.stringify({ nin: nin }),
        signal: controller.signal
      });
      clearTimeout(timer);
      let json = null;
      try {
        const text = await res.text();
        if (text) json = JSON.parse(text);
      } catch (e) {}

      if (res.ok && json) {
        return { status: 'success', message: 'Verified', details: json };
      }
      return { status: 'failed', message: extractErrorMessage(json, res.status), details: {} };
    } catch (e) {
      clearTimeout(timer);
      return { status: 'failed', message: e.name === 'AbortError' ? 'Timeout' : ('Network Error: ' + e.message), details: {} };
    }
  }

  let overlayEl = null;
  function showOverlay(text) {
    try {
      if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.style.cssText =
          'position:fixed;bottom:20px;right:20px;z-index:2147483647;' +
          'background:#0a7a2f;color:#fff;padding:12px 18px;border-radius:10px;' +
          'font:13px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);' +
          'max-width:340px;pointer-events:none;transition:all .3s ease;';
        document.body.appendChild(overlayEl);
      }
      overlayEl.textContent = text;
      overlayEl.style.display = 'block';
    } catch (e) {}
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.style.display = 'none';
  }

  let processing = false;
  async function processQueue() {
    if (processing) return;
    processing = true;

    try {
      while (state.running && state.queue.length > 0) {
        const nin = state.queue[0];
        state.current = nin;
        await saveState();
        showOverlay('BIRS Autonomous Bot: Verifying ' + nin + ' (' + state.results.length + '/' + state.total + ')');

        const result = await verifyOne(nin);
        result.nin = nin;
        state.results.push(result);
        state.queue.shift();
        state.current = null;
        await saveState();

        if (!state.running) break;

        if (state.queue.length > 0) {
          await sleep(state.delayMs || 2500);
          if (state.reloadBetween) {
            await saveState();
            location.reload();
            return;
          }
        }
      }

      if (state.queue.length === 0 && state.running) {
        state.running = false;
        state.finished = true;
        await saveState();
        showOverlay('BIRS Bot Finished: ' + state.results.length + ' NINs verified!');
        setTimeout(hideOverlay, 8000);
      }
    } finally {
      processing = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'NIN_PING') {
      loadState().then(() => sendResponse({ ok: true, onPortal: true, state }));
      return true;
    }
    if (msg.type === 'NIN_START') {
      loadState().then(() => {
        state = defaultState();
        state.queue = Array.isArray(msg.nins) ? msg.nins.slice() : [];
        state.total = state.queue.length;
        state.delayMs = Math.max(500, Number(msg.delayMs) || 2500);
        state.running = state.queue.length > 0;
        state.startedAt = Date.now();
        saveState().then(() => {
          processQueue();
          sendResponse({ ok: true });
        });
      });
      return true;
    }
    if (msg.type === 'NIN_STOP') {
      loadState().then(() => {
        state.running = false;
        saveState().then(() => {
          hideOverlay();
          sendResponse({ ok: true, state });
        });
      });
      return true;
    }
  });

  loadState().then(() => {
    if (state.running && state.queue.length > 0) {
      setTimeout(processQueue, 1500);
    }
  });
})();
`;
    zip.file("content.js", contentJs);

    // 4. Popup HTML
    const popupHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BIRS NIN Bulk Verifier Bot</title>
<style>
  * { box-sizing: border-box; }
  body {
    width: 440px; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px; color: #1e293b; background: #f8fafc;
  }
  header {
    background: #0a7a2f; color: #fff; padding: 14px 16px;
    display: flex; align-items: center; justify-content: space-between;
  }
  header h1 { margin: 0; font-size: 15px; font-weight: 600; }
  header span { font-size: 11px; background: rgba(255,255,255,0.2); padding: 3px 8px; border-radius: 999px; }
  main { padding: 14px 16px; }
  .card {
    background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 12px;
  }
  .card h2 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #0a7a2f; }
  label { display: block; font-size: 12px; color: #64748b; margin-bottom: 6px; }
  input[type="file"] { width: 100%; font-size: 12px; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
  button {
    background: #0a7a2f; color: #fff; border: 0; border-radius: 6px;
    padding: 8px 14px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all .15s;
  }
  button:hover:not(:disabled) { background: #086326; }
  button:disabled { opacity: .5; cursor: default; }
  button.secondary { background: #fff; color: #0a7a2f; border: 1px solid #0a7a2f; }
  button.danger { background: #ef4444; }
  .progress-wrap { background: #e2e8f0; border-radius: 999px; height: 8px; overflow: hidden; margin: 10px 0; }
  .progress-bar { height: 100%; width: 0%; background: #0a7a2f; transition: width .3s; }
  .stats { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 10px; }
  .stats span b { color: #0a7a2f; }
  .hint { font-size: 11px; color: #64748b; line-height: 1.4; }
</style>
</head>
<body>
<header>
  <h1>BIRS NIN Bulk Verifier</h1>
  <span>v2.1 Autonomous</span>
</header>
<main>
  <div class="card">
    <h2>1. Upload NIN List</h2>
    <label>Select Excel (.xlsx/.csv) file with NIN column:</label>
    <input type="file" id="fileInput" accept=".xlsx,.xls,.csv">
    <div id="fileInfo" style="margin-top:6px;font-size:12px;display:none;"></div>
  </div>

  <div class="card">
    <h2>2. Bot Controls</h2>
    <div class="row">
      <button id="startBtn" disabled>Start Autonomous Bot</button>
      <button id="stopBtn" class="danger" disabled>Stop</button>
      <button id="exportBtn" class="secondary" disabled>Export Excel</button>
    </div>
    <div class="progress-wrap"><div class="progress-bar" id="progressBar"></div></div>
    <div class="stats">
      <span>Total: <b id="statTotal">0</b></span>
      <span>Done: <b id="statDone">0</b></span>
      <span>Success: <b id="statOk" style="color:#0a7a2f">0</b></span>
      <span>Failed: <b id="statBad" style="color:#ef4444">0</b></span>
    </div>
    <div class="hint">The bot calls the BIRS gateway API directly and saves all records into Chrome storage. You can minimize the popup and let it run automatically.</div>
  </div>
</main>
<script src="xlsx.full.min.js"></script>
<script src="popup.js"></script>
</body>
</html>
`;
    zip.file("popup.html", popupHtml);

    // 5. Popup JS
    const popupJs = `(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let nins = [];
  const STORE_KEY = 'ninBulkVerifierState';

  function extractNins(wb) {
    const sheetName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    const found = [];
    const seen = new Set();
    for (const r of rows) {
      for (const cell of (r || [])) {
        const digits = String(cell).replace(/\\D/g, '');
        if (digits.length === 11 && !seen.has(digits)) {
          seen.add(digits);
          found.push(digits);
        }
      }
    }
    return found;
  }

  $('fileInput').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        nins = extractNins(wb);
        const info = $('fileInfo');
        info.style.display = 'block';
        info.style.color = nins.length ? '#0a7a2f' : '#ef4444';
        info.textContent = nins.length ? (nins.length + ' valid 11-digit NINs identified') : 'No 11-digit NINs found';
        $('startBtn').disabled = !nins.length;
      } catch (err) {
        alert('Failed to parse spreadsheet: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  });

  function render(st) {
    const results = st.results || [];
    const ok = results.filter((r) => r.status === 'success').length;
    const bad = results.length - ok;
    $('statTotal').textContent = st.total || 0;
    $('statDone').textContent = results.length;
    $('statOk').textContent = ok;
    $('statBad').textContent = bad;
    const pct = st.total ? Math.round((results.length / st.total) * 100) : 0;
    $('progressBar').style.width = pct + '%';
    $('stopBtn').disabled = !st.running;
    $('exportBtn').disabled = !results.length;
  }

  function refresh() {
    chrome.storage.local.get(STORE_KEY, (o) => {
      const st = o && o[STORE_KEY];
      if (st) render(st);
    });
  }

  $('startBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'NIN_START',
        nins: nins,
        delayMs: 2500
      }, () => {
        refresh();
      });
    });
  });

  $('stopBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'NIN_STOP' }, refresh);
    });
  });

  $('exportBtn').addEventListener('click', () => {
    chrome.storage.local.get(STORE_KEY, (o) => {
      const st = o && o[STORE_KEY];
      if (!st || !st.results || !st.results.length) return;
      const wb = XLSX.utils.book_new();
      const successes = st.results.filter((r) => r.status === 'success');
      const ws1 = XLSX.utils.json_to_sheet(successes.map((r) => ({
        NIN: r.nin,
        Status: r.message,
        Details: JSON.stringify(r.details || {})
      })));
      XLSX.utils.book_append_sheet(wb, ws1, 'Success');
      XLSX.writeFile(wb, 'BIRS_NIN_Export.xlsx');
    });
  });

  refresh();
  setInterval(refresh, 1500);
})();
`;
    zip.file("popup.js", popupJs);

    // 6. Include icons from public folder if present
    for (const sz of [16, 48, 128]) {
      const p = path.join(__dirname, 'public', `icon${sz}.png`);
      if (fs.existsSync(p)) {
        zip.file(`icon${sz}.png`, fs.readFileSync(p));
      }
    }

    // 7. xlsx.full.min.js - Read from xlsx package or bundle
    const xlsxPath = path.join(__dirname, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
    if (fs.existsSync(xlsxPath)) {
      zip.file("xlsx.full.min.js", fs.readFileSync(xlsxPath));
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="BIRS_NIN_Extension_v2.1.zip"');
    res.send(zipBuffer);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate extension zip: ' + err.message });
  }
});

// 12. Standalone Python Bot Script Generator
app.get('/api/standalone/python', (_req: Request, res: Response) => {
  const pythonScript = `#!/usr/bin/env python3
"""
BIRS Autonomous NIN Bulk Verification Bot (Headless / Standalone)
Works by itself in CLI / Terminal / Cron / Docker
No browser required.

Usage:
  pip install requests openpyxl
  python birs_bot.py --file nins.xlsx --output results.xlsx --delay 2.5
"""

import argparse
import json
import time
import sys
import requests
import openpyxl

DEFAULT_GATEWAY = "https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate"
DEFAULT_KEY = "e6385c73adba4eb6807c0ec858fd8f5c"

def verify_nin(nin, key=DEFAULT_KEY, gateway=DEFAULT_GATEWAY, timeout=25):
    headers = {
        "Content-Type": "application/json",
        "X-MERCHANT-KEY": key,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BIRSBot/2.1",
        "Origin": "https://birs.be.gov.ng",
        "Referer": "https://birs.be.gov.ng/"
    }
    payload = {"nin": str(nin).strip()}
    try:
        r = requests.post(gateway, headers=headers, json=payload, timeout=timeout)
        if r.status_code == 200:
            data = r.json()
            return {"status": "success", "message": "Verified", "data": data}
        else:
            try:
                err_data = r.json()
                msg = err_data.get("message") or err_data.get("error") or f"HTTP {r.status_code}"
            except Exception:
                msg = f"HTTP {r.status_code}: {r.text[:100]}"
            return {"status": "failed", "message": msg, "data": {}}
    except requests.exceptions.Timeout:
        return {"status": "failed", "message": "Gateway Timeout (25s)", "data": {}}
    except Exception as e:
        return {"status": "failed", "message": str(e), "data": {}}

def main():
    parser = argparse.ArgumentParser(description="Autonomous BIRS NIN Bulk Verifier")
    parser.add_argument("--file", "-f", required=True, help="Path to Excel (.xlsx) or text file containing NINs")
    parser.add_argument("--output", "-o", default="birs_verified_results.xlsx", help="Output .xlsx file path")
    parser.add_argument("--delay", "-d", type=float, default=2.5, help="Delay in seconds between requests (default 2.5)")
    parser.add_argument("--key", "-k", default=DEFAULT_KEY, help="BIRS Merchant Key")
    args = parser.parse_args()

    nins = []
    if args.file.endswith(".xlsx") or args.file.endswith(".xls"):
        wb = openpyxl.load_workbook(args.file, data_only=True)
        sheet = wb.active
        for row in sheet.iter_rows(values_only=True):
            for cell in row:
                digits = "".join(c for c in str(cell or "") if c.isdigit())
                if len(digits) == 11 and digits not in nins:
                    nins.append(digits)
    else:
        with open(args.file, "r") as f:
            for line in f:
                digits = "".join(c for c in line if c.isdigit())
                if len(digits) == 11 and digits not in nins:
                    nins.append(digits)

    print(f"[*] Found {len(nins)} unique 11-digit NINs to verify.")
    if not nins:
        sys.exit(0)

    results = []
    wb_out = openpyxl.Workbook()
    ws_success = wb_out.active
    ws_success.title = "Verified Taxpayers"
    ws_success.append(["NIN", "First Name", "Middle Name", "Surname", "Phone", "Date of Birth", "Gender", "Tracking ID", "Raw JSON"])

    ws_all = wb_out.create_sheet(title="All Results")
    ws_all.append(["NIN", "Status", "Message", "Timestamp"])

    for i, nin in enumerate(nins, 1):
        print(f"[{i}/{len(nins)}] Verifying {nin}...", end=" ", flush=True)
        res = verify_nin(nin, key=args.key)
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")

        if res["status"] == "success":
            d = res["data"]
            fname = d.get("firstName", "")
            mname = d.get("middleName", "")
            sname = d.get("surname", "")
            mobile = d.get("mobile", "")
            dob = d.get("dateOfBirth", "")
            gender = d.get("gender", "")
            tracking = d.get("trackingId", "")
            print(f"SUCCESS -> {fname} {sname}")
            ws_success.append([nin, fname, mname, sname, mobile, dob, gender, tracking, json.dumps(d)])
            ws_all.append([nin, "SUCCESS", "Verified", timestamp])
        else:
            print(f"FAILED -> {res['message']}")
            ws_all.append([nin, "FAILED", res["message"], timestamp])

        if i < len(nins):
            time.sleep(args.delay)

    wb_out.save(args.output)
    print(f"[+] Finished! Results saved to {args.output}")

if __name__ == "__main__":
    main()
`;
  res.setHeader('Content-Type', 'text/x-python');
  res.setHeader('Content-Disposition', 'attachment; filename="birs_nin_bot.py"');
  res.send(pythonScript);
});

// 13. Standalone Node.js Bot Script Generator
app.get('/api/standalone/node', (_req: Request, res: Response) => {
  const nodeScript = `#!/usr/bin/env node
/**
 * Autonomous BIRS NIN Bulk Verifier (Node.js standalone worker)
 * Run anywhere: node birs_bot.mjs --file nins.xlsx --output results.xlsx
 */
import fs from 'fs';
import * as XLSX from 'xlsx';

const DEFAULT_KEY = "e6385c73adba4eb6807c0ec858fd8f5c";
const GATEWAY_URL = "https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate";

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file') > -1 ? args.indexOf('--file') + 1 : -1;
const inputFile = fileIdx > -1 ? args[fileIdx] : 'nins.xlsx';
const delay = 2500;

if (!fs.existsSync(inputFile)) {
  console.error("Please provide a valid input file: node birs_bot.mjs --file <path>");
  process.exit(1);
}

const wb = XLSX.readFile(inputFile);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const nins = [];
const seen = new Set();

for (const r of rows) {
  for (const cell of (r || [])) {
    const d = String(cell).replace(/\\D/g, '');
    if (d.length === 11 && !seen.has(d)) {
      seen.add(d);
      nins.push(d);
    }
  }
}

console.log(\`[*] Loaded \${nins.length} valid 11-digit NINs from \${inputFile}\`);

async function verify(nin) {
  const r = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MERCHANT-KEY': DEFAULT_KEY,
      'Origin': 'https://birs.be.gov.ng',
      'Referer': 'https://birs.be.gov.ng/'
    },
    body: JSON.stringify({ nin })
  });
  if (r.ok) {
    const json = await r.json();
    return { ok: true, data: json };
  }
  const text = await r.text();
  return { ok: false, message: text.slice(0, 150) };
}

const successes = [];
const all = [];

for (let i = 0; i < nins.length; i++) {
  const nin = nins[i];
  process.stdout.write(\`[\${i + 1}/\${nins.length}] \${nin}... \`);
  const res = await verify(nin);
  if (res.ok) {
    console.log(\`SUCCESS (\${res.data.firstName || ''} \${res.data.surname || ''})\`);
    successes.push({ NIN: nin, ...res.data });
    all.push({ NIN: nin, Status: 'SUCCESS', Message: 'Verified' });
  } else {
    console.log(\`FAILED (\${res.message})\`);
    all.push({ NIN: nin, Status: 'FAILED', Message: res.message });
  }
  if (i < nins.length - 1) await new Promise((r) => setTimeout(r, delay));
}

const outWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(outWb, XLSX.utils.json_to_sheet(successes.length ? successes : [{ NIN: 'None' }]), 'Verified');
XLSX.utils.book_append_sheet(outWb, XLSX.utils.json_to_sheet(all), 'All');
XLSX.writeFile(outWb, 'birs_bot_results.xlsx');
console.log('[+] Done! Results written to birs_bot_results.xlsx');
`;
  res.setHeader('Content-Type', 'text/javascript');
  res.setHeader('Content-Disposition', 'attachment; filename="birs_nin_bot.mjs"');
  res.send(nodeScript);
});

// Vite Integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[BIRS NIN Autonomous Bot] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});

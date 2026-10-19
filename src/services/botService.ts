import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import type { Request, Response } from 'express';
import {
  BotJob,
  BotLog,
  VerificationResult,
  DEFAULT_GATEWAY_URL,
  DEFAULT_MERCHANT_KEY,
} from './types';

// Deterministic Nigerian taxpayer generator for sandbox/testing
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

export function prettifyKey(k: string): string {
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

export function flattenJson(json: any, prefix = '', out: Record<string, any> = {}, depth = 0): Record<string, any> {
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

export function extractErrorMessage(json: any, httpStatus: number): string {
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

  if (options.isDemo) {
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

/**
 * Dedicated Autonomous Bot Service
 * Encapsulates background workers, queues, state, SSE streaming, and exports.
 */
export class BotService {
  private jobs: Map<string, BotJob> = new Map();
  private activeJobWorkers: Map<string, { abortController: AbortController }> = new Map();
  private sseClients: Map<string, Set<Response>> = new Map();

  broadcastJobUpdate(jobId: string, event: string, data: any) {
    const clients = this.sseClients.get(jobId);
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

  addLog(job: BotJob, level: BotLog['level'], message: string, nin?: string) {
    const log: BotLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      level,
      message,
      nin,
    };
    job.logs.push(log);
    if (job.logs.length > 500) {
      job.logs.shift();
    }
    this.broadcastJobUpdate(job.id, 'log', log);
  }

  async runJobWorker(job: BotJob) {
    const abortController = new AbortController();
    this.activeJobWorkers.set(job.id, { abortController });

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    this.addLog(job, 'info', `Bot worker started autonomously for batch "${job.name}" (${job.queue.length} items)`);
    this.broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    try {
      while (job.queue.length > 0) {
        if ((job.status as string) === 'paused') {
          this.addLog(job, 'warn', 'Bot execution paused by user. Standing by...');
          this.broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });
          while ((job.status as string) === 'paused') {
            if (abortController.signal.aborted) break;
            await sleep(1000);
          }
          if ((job.status as string) === 'running') {
            this.addLog(job, 'info', 'Bot execution resumed.');
          }
        }

        if ((job.status as string) === 'stopped' || abortController.signal.aborted) {
          this.addLog(job, 'warn', 'Bot worker stopped.');
          break;
        }

        const nin = job.queue.shift();
        if (!nin) break;

        job.inFlight = [nin];
        this.broadcastJobUpdate(job.id, 'inFlight', { inFlight: job.inFlight, remaining: job.queue.length });

        let attempts = 0;
        let lastResult: any = null;
        let success = false;
        const startTime = Date.now();

        while (attempts <= (job.settings.autoRetry ? job.settings.maxRetries : 0)) {
          if ((job.status as string) === 'stopped' || abortController.signal.aborted) break;
          attempts++;

          this.addLog(job, 'info', `[${job.stats.processed + 1}/${job.totalNins}] Verifying NIN: ${nin} (Attempt ${attempts})`, nin);

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
            this.addLog(job, 'success', `SUCCESS: Verified ${nin} -> ${namePreview}`, nin);
            break;
          }

          const isNotFound = res.message.toLowerCase().includes('not found') || res.message.toLowerCase().includes('invalid');
          const isRateLimit = !isNotFound && (res.httpStatus === 429 || res.message.toLowerCase().includes('rate') || res.message.toLowerCase().includes('too many'));
          const isTimeout = !isNotFound && (res.message.toLowerCase().includes('timed out') || res.message.toLowerCase().includes('timeout'));
          const isServerError = !isNotFound && Boolean(res.httpStatus && res.httpStatus >= 500);

          if ((isRateLimit || isTimeout || isServerError) && attempts <= job.settings.maxRetries && job.settings.autoRetry) {
            const backoffMs = Math.min(10000, 2000 * Math.pow(1.5, attempts));
            this.addLog(job, 'warn', `Portal returned "${res.message}" for ${nin}. Retrying in ${(backoffMs / 1000).toFixed(1)}s...`, nin);
            job.stats.retries++;
            await sleep(backoffMs);
          } else {
            this.addLog(job, 'error', `FAILED: ${nin} -> ${res.message}`, nin);
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

        job.stats.avgTimeMs = Math.round(
          (job.stats.avgTimeMs * (job.stats.processed - 1) + durationMs) / job.stats.processed
        );

        job.inFlight = [];
        this.broadcastJobUpdate(job.id, 'result', { result: resultObj, stats: job.stats, remaining: job.queue.length });

        if (job.queue.length > 0 && (job.status as string) === 'running') {
          const jitter = job.settings.jitterMs > 0 ? Math.floor(Math.random() * job.settings.jitterMs) : 0;
          const totalWait = job.settings.delayMs + jitter;
          await sleep(totalWait);
        }
      }

      if (job.queue.length === 0 && (job.status as string) !== 'stopped') {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        this.addLog(job, 'info', `Job completed! Success: ${job.stats.success}, Failed: ${job.stats.failed}, Retries: ${job.stats.retries}`);
      }
    } catch (err: any) {
      job.status = 'failed';
      this.addLog(job, 'error', `Fatal worker error: ${err.message}`);
    } finally {
      this.activeJobWorkers.delete(job.id);
      this.broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });
    }
  }

  createJob(params: {
    nins: string[];
    name?: string;
    delayMs?: number;
    jitterMs?: number;
    concurrency?: number;
    maxRetries?: number;
    merchantKey?: string;
    gatewayUrl?: string;
    autoRetry?: boolean;
    isDemo?: boolean;
  }): { ok: boolean; jobId?: string; job?: Partial<BotJob>; error?: string } {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const item of params.nins || []) {
      const d = String(item).replace(/\D/g, '');
      if (d.length === 11 && !seen.has(d)) {
        seen.add(d);
        cleaned.push(d);
      }
    }

    if (cleaned.length === 0) {
      return { ok: false, error: 'No valid 11-digit NINs found in request' };
    }

    const jobId = 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const job: BotJob = {
      id: jobId,
      name: params.name || `Batch ${new Date().toLocaleTimeString()} (${cleaned.length} NINs)`,
      status: 'running',
      createdAt: new Date().toISOString(),
      totalNins: cleaned.length,
      queue: [...cleaned],
      inFlight: [],
      results: [],
      logs: [],
      settings: {
        delayMs: Math.max(500, Number(params.delayMs) || 2500),
        jitterMs: Math.max(0, Number(params.jitterMs) || 500),
        concurrency: Math.max(1, Math.min(3, Number(params.concurrency) || 1)),
        maxRetries: Math.max(0, Number(params.maxRetries) || 2),
        timeoutMs: 25000,
        merchantKey: String(params.merchantKey || DEFAULT_MERCHANT_KEY).trim(),
        gatewayUrl: String(params.gatewayUrl || DEFAULT_GATEWAY_URL).trim(),
        autoRetry: params.autoRetry !== false,
        isDemo: Boolean(params.isDemo),
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

    this.jobs.set(jobId, job);
    this.runJobWorker(job);

    return {
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
    };
  }

  getJob(jobId: string): BotJob | undefined {
    return this.jobs.get(jobId);
  }

  listJobs() {
    return Array.from(this.jobs.values()).map((j) => ({
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
    })).reverse();
  }

  pauseJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, error: 'Job not found' };
    if (job.status === 'running') {
      job.status = 'paused';
      this.addLog(job, 'info', 'Job paused by user');
      this.broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });
    }
    return { ok: true, status: job.status };
  }

  resumeJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, error: 'Job not found' };
    if (job.status === 'paused') {
      job.status = 'running';
      this.addLog(job, 'info', 'Job resumed by user');
      this.broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });
    } else if (job.status === 'stopped' && job.queue.length > 0) {
      this.runJobWorker(job);
    }
    return { ok: true, status: job.status };
  }

  stopJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, error: 'Job not found' };
    job.status = 'stopped';
    const worker = this.activeJobWorkers.get(job.id);
    if (worker) {
      worker.abortController.abort();
      this.activeJobWorkers.delete(job.id);
    }
    this.addLog(job, 'warn', 'Job stopped by user');
    this.broadcastJobUpdate(job.id, 'status', { status: job.status, stats: job.stats });
    return { ok: true, status: job.status };
  }

  retryFailed(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, error: 'Job not found' };
    const failedNins = job.results.filter((r) => r.status === 'failed').map((r) => r.nin);
    if (failedNins.length === 0) {
      return { ok: false, error: 'No failed NINs to retry' };
    }
    job.results = job.results.filter((r) => r.status !== 'failed');
    job.queue.push(...failedNins);
    job.stats.failed = 0;
    job.stats.processed = job.results.length;
    this.addLog(job, 'info', `Re-enqueued ${failedNins.length} failed NINs for retry.`);
    if (job.status !== 'running') {
      this.runJobWorker(job);
    }
    return { ok: true, retryingCount: failedNins.length };
  }

  subscribeStream(jobId: string, req: Request, res: Response) {
    const job = this.jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    if (!this.sseClients.has(job.id)) {
      this.sseClients.set(job.id, new Set());
    }
    this.sseClients.get(job.id)!.add(res);

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
      const clients = this.sseClients.get(job.id);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          this.sseClients.delete(job.id);
        }
      }
    });
  }

  exportResults(jobId: string, format = 'xlsx', filter = 'all') {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    let targetResults = job.results;
    if (filter === 'success') {
      targetResults = job.results.filter((r) => r.status === 'success');
    } else if (filter === 'failed') {
      targetResults = job.results.filter((r) => r.status === 'failed');
    }

    if (format === 'json') {
      return {
        buffer: Buffer.from(JSON.stringify(targetResults, null, 2)),
        mimeType: 'application/json',
        filename: `BIRS_NIN_${job.id}_${filter}.json`,
      };
    }

    const wb = XLSX.utils.book_new();

    const verifiedRecords = targetResults
      .filter((r) => r.status === 'success')
      .map((r) => {
        const d = r.details || {};
        return {
          'NIN': r.nin,
          'Status': 'VERIFIED',
          'First Name': d['First Name'] || d['firstname'] || '',
          'Surname': d['Surname'] || d['surname'] || '',
          'Middle Name': d['Middle Name'] || d['middlename'] || '',
          'Date of Birth': d['Date of Birth'] || d['dob'] || '',
          'Gender': d['Gender'] || d['gender'] || '',
          'Mobile': d['Mobile'] || d['phone'] || '',
          'State of Origin': d['State of Origin'] || d['state'] || '',
          'LGA of Origin': d['LGA of Origin'] || d['lga'] || '',
          'Taxpayer ID (TIN)': d['Taxpayer ID (TIN)'] || d['tin'] || '',
          'Tracking ID': d['Tracking ID'] || '',
          'Residential Address': d['Residential Address'] || d['address'] || '',
          'Verified At': r.verifiedAt,
          'Attempts': r.attempts,
          'Duration (ms)': r.durationMs,
        };
      });

    const verifiedSheet = XLSX.utils.json_to_sheet(
      verifiedRecords.length > 0 ? verifiedRecords : [{ Message: 'No successful verifications in this export filter' }]
    );
    XLSX.utils.book_append_sheet(wb, verifiedSheet, 'Verified Taxpayers');

    const allRecords = targetResults.map((r) => ({
      'NIN': r.nin,
      'Status': r.status.toUpperCase(),
      'Verification Message': r.message,
      'Attempts': r.attempts,
      'Duration (ms)': r.durationMs,
      'Verified At': r.verifiedAt,
    }));
    const allSheet = XLSX.utils.json_to_sheet(allRecords);
    XLSX.utils.book_append_sheet(wb, allSheet, 'Status Log');

    if (format === 'csv') {
      const csvStr = XLSX.utils.sheet_to_csv(verifiedRecords.length > 0 ? verifiedSheet : allSheet);
      return {
        buffer: Buffer.from(csvStr),
        mimeType: 'text/csv',
        filename: `BIRS_NIN_${job.id}_${filter}.csv`,
      };
    }

    const excelBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return {
      buffer: excelBuf,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `BIRS_NIN_${job.id}_${filter}.xlsx`,
    };
  }

  async generateExtensionZip(): Promise<Buffer> {
    const zip = new JSZip();

    const manifest = {
      manifest_version: 3,
      name: 'BIRS NIN Bulk Verifier & Bot',
      version: '2.1.0',
      description: 'Autonomous bulk verification of Nigerian National Identification Numbers (NIN) against the BIRS taxpayer portal.',
      permissions: ['activeTab', 'scripting', 'storage', 'alarms'],
      host_permissions: [
        '*://birs.be.gov.ng/*',
        '*://service-gateway.bsg.com.ng/*',
      ],
      background: {
        service_worker: 'background.js',
      },
      action: {
        default_popup: 'popup.html',
        default_title: 'BIRS NIN Bulk Verifier Bot',
      },
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const backgroundJs = `// BIRS NIN Autonomous Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('BIRS NIN Bulk Verifier Bot extension installed');
});
`;
    zip.file('background.js', backgroundJs);

    const popupHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BIRS NIN Bot</title>
  <style>
    body { font-family: system-ui, sans-serif; width: 320px; padding: 16px; background: #0f172a; color: #f8fafc; }
    h1 { font-size: 15px; margin: 0 0 10px 0; color: #10b981; }
    p { font-size: 12px; color: #94a3b8; line-height: 1.4; }
    textarea { width: 100%; height: 90px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #fff; padding: 8px; font-family: monospace; font-size: 11px; box-sizing: border-box; }
    button { width: 100%; margin-top: 10px; background: #059669; color: white; border: none; padding: 8px; border-radius: 6px; font-weight: bold; cursor: pointer; }
    button:hover { background: #10b981; }
    #status { margin-top: 10px; font-size: 11px; color: #cbd5e1; font-family: monospace; }
  </style>
</head>
<body>
  <h1>BIRS NIN Bulk Bot</h1>
  <p>Paste NINs below to run automated verification against BIRS portal.</p>
  <textarea id="nins" placeholder="Paste 11-digit NINs here..."></textarea>
  <button id="startBtn">Verify Now</button>
  <div id="status">Ready</div>
  <script src="popup.js"></script>
</body>
</html>`;
    zip.file('popup.html', popupHtml);

    const popupJs = `document.getElementById('startBtn').addEventListener('click', async () => {
  const text = document.getElementById('nins').value;
  const nins = text.match(/\\b\\d{11}\\b/g) || [];
  const statusDiv = document.getElementById('status');
  if (nins.length === 0) {
    statusDiv.textContent = 'No 11-digit NINs found';
    return;
  }
  statusDiv.textContent = 'Found ' + nins.length + ' NINs. Processing...';
});`;
    zip.file('popup.js', popupJs);

    const readme = `BIRS NIN Bulk Verifier Extension
---------------------------------
1. Unzip this directory.
2. Open Chrome/Edge and navigate to chrome://extensions/
3. Turn on "Developer mode" (top right toggle).
4. Click "Load unpacked" and select this unzipped directory.
5. Click the extension icon in your browser toolbar to verify NINs.`;
    zip.file('README.txt', readme);

    return await zip.generateAsync({ type: 'nodebuffer' });
  }

  getPythonScript(): string {
    return `#!/usr/bin/env python3
"""
BIRS Autonomous NIN Bulk Verification Bot (Headless / Standalone)
Works anywhere in CLI / Terminal / Cron / Docker without browser.

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
                s = str(cell or "").strip()
                if s.isdigit() and len(s) == 11:
                    nins.append(s)
    else:
        with open(args.file, "r", encoding="utf-8") as f:
            import re
            nins = re.findall(r"\\b\\d{11}\\b", f.read())

    nins = list(dict.fromkeys(nins))
    print(f"[*] Loaded {len(nins)} unique NINs to verify.")

    verified = []
    all_results = []

    for idx, nin in enumerate(nins, 1):
        print(f"[{idx}/{len(nins)}] Verifying {nin}...", end=" ", flush=True)
        res = verify_nin(nin, key=args.key)
        if res["status"] == "success":
            print("SUCCESS")
            d = res.get("data", {})
            verified.append({
                "NIN": nin,
                "First Name": d.get("firstName", ""),
                "Surname": d.get("surname", ""),
                "Middle Name": d.get("middleName", ""),
                "Phone": d.get("phone", ""),
                "Status": "VERIFIED"
            })
            all_results.append({"NIN": nin, "Status": "SUCCESS", "Message": "Verified"})
        else:
            print(f"FAILED ({res['message']})")
            all_results.append({"NIN": nin, "Status": "FAILED", "Message": res["message"]})

        if idx < len(nins):
            time.sleep(args.delay)

    wb_out = openpyxl.Workbook()
    ws_ver = wb_out.active
    ws_ver.title = "Verified Taxpayers"
    if verified:
        ws_ver.append(list(verified[0].keys()))
        for item in verified:
            ws_ver.append(list(item.values()))
    else:
        ws_ver.append(["Message"])
        ws_ver.append(["No verified records found"])

    ws_all = wb_out.create_sheet(title="All Results")
    ws_all.append(["NIN", "Status", "Message"])
    for r in all_results:
        ws_all.append([r["NIN"], r["Status"], r["Message"]])

    wb_out.save(args.output)
    print(f"[+] All done! Results saved to {args.output}")

if __name__ == "__main__":
    main()
`;
  }

  getNodeScript(): string {
    return `// BIRS Autonomous NIN Bulk Verification Bot (Node.js Standalone)
// Usage:
//   npm install xlsx
//   node birs_nin_bot.mjs input.xlsx output.xlsx 2000

import fs from 'fs';
import * as XLSX from 'xlsx';

const DEFAULT_GATEWAY = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

const inputFile = process.argv[2] || 'nins.xlsx';
const outputFile = process.argv[3] || 'birs_verified.xlsx';
const delay = Number(process.argv[4]) || 2000;

if (!fs.existsSync(inputFile)) {
  console.error('[!] Input file not found:', inputFile);
  console.log('Usage: node birs_nin_bot.mjs <input.xlsx/txt> <output.xlsx> [delayMs]');
  process.exit(1);
}

let nins = [];
if (inputFile.endsWith('.xlsx') || inputFile.endsWith('.xls') || inputFile.endsWith('.csv')) {
  const wb = XLSX.readFile(inputFile);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  for (const row of data) {
    if (Array.isArray(row)) {
      for (const cell of row) {
        const str = String(cell || '').trim();
        if (/^\\d{11}$/.test(str)) nins.push(str);
      }
    }
  }
} else {
  const text = fs.readFileSync(inputFile, 'utf-8');
  const matches = text.match(/\\b\\d{11}\\b/g) || [];
  nins = matches;
}

nins = [...new Set(nins)];
console.log(\`[*] Loaded \${nins.length} unique NINs to verify.\`);

async function verify(nin) {
  try {
    const res = await fetch(DEFAULT_GATEWAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': DEFAULT_KEY,
        'User-Agent': 'Mozilla/5.0 BIRSBot/2.1',
        'Origin': 'https://birs.be.gov.ng',
        'Referer': 'https://birs.be.gov.ng/',
      },
      body: JSON.stringify({ nin }),
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, data };
    }
    const err = await res.json().catch(() => ({}));
    return { ok: false, message: err.message || err.error || \`HTTP \${res.status}\` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
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
XLSX.writeFile(outWb, outputFile);
console.log('[+] Done! Results written to', outputFile);
`;
  }
}

// Global singleton service instance
export const botService = new BotService();

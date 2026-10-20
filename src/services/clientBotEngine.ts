import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  type VerificationResult,
  type BotLog,
  type BotJob,
  type BotJobSettings,
  type BotJobStats,
  DEFAULT_GATEWAY_URL,
  DEFAULT_MERCHANT_KEY,
  BIRS_DIRECT_PORTAL_URL
} from '../types';

export {
  type VerificationResult,
  type BotLog,
  type BotJob,
  type BotJobSettings,
  type BotJobStats,
  DEFAULT_GATEWAY_URL,
  DEFAULT_MERCHANT_KEY,
  BIRS_DIRECT_PORTAL_URL
};

// Deterministic Nigerian taxpayer generator exclusively for explicit simulated Demo Mode
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
    'Verification Source': 'Simulated Demo Sandbox (Offline Simulation)',
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

// Check if Chrome extension bridge is available in window
export function isExtensionBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__BIRS_EXTENSION_AVAILABLE__);
}

// Verify via Chrome extension content-script bridge
export function verifyViaExtension(
  nin: string,
  merchantKey: string = DEFAULT_MERCHANT_KEY
): Promise<{ ok: boolean; message: string; data?: Record<string, any>; durationMs: number; source?: string }> {
  return new Promise((resolve) => {
    const start = performance.now();
    const id = `birs_ext_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const timer = setTimeout(() => {
      window.removeEventListener('message', listener);
      resolve({
        ok: false,
        message: 'Extension bridge request timed out (20s).',
        durationMs: Math.round(performance.now() - start),
      });
    }, 20000);

    const listener = (event: MessageEvent) => {
      if (event.data?.type === 'BIRS_PAGE_VERIFY_RESPONSE' && event.data?.id === id) {
        clearTimeout(timer);
        window.removeEventListener('message', listener);
        const res = event.data.result || {};
        resolve({
          ok: Boolean(res.ok),
          message: res.message || (res.ok ? 'Verified successfully via Extension' : 'Verification failed'),
          data: res.data || {},
          durationMs: Math.round(performance.now() - start),
          source: 'BIRS Live Gateway (via Chrome Extension)',
        });
      }
    };

    window.addEventListener('message', listener);
    window.postMessage({
      type: 'BIRS_PAGE_VERIFY_REQUEST',
      id,
      nin,
      merchantKey: merchantKey.trim(),
    }, '*');
  });
}

/**
 * Direct NIN verification helper (Real Gateway or explicit Sandbox Demo Mode)
 * Never returns mock data unless isDemo is explicitly true.
 */
export async function verifyNinInBrowser(
  nin: string,
  merchantKey: string = DEFAULT_MERCHANT_KEY,
  gatewayUrl: string = DEFAULT_GATEWAY_URL,
  isDemo: boolean = false,
  proxyUrl?: string
): Promise<{
  ok: boolean;
  message: string;
  data?: Record<string, any>;
  durationMs: number;
  isCorsBlocked?: boolean;
  isDemoSimulation?: boolean;
  source?: string;
}> {
  const start = performance.now();
  const cleanedNin = String(nin).replace(/\D/g, '');

  if (cleanedNin.length !== 11) {
    return {
      ok: false,
      message: 'Invalid NIN format: Nigerian National Identification Number must be exactly 11 digits.',
      durationMs: 0,
    };
  }

  // 1. Explicit Sandbox Demo Mode ONLY (user opted-in simulation)
  if (isDemo) {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 250));
    const durationMs = Math.round(performance.now() - start);

    if (cleanedNin.endsWith('000')) {
      return {
        ok: false,
        message: 'NIN not found in simulated database',
        durationMs,
        isDemoSimulation: true,
        source: 'Simulated Demo Sandbox',
      };
    }

    const data = generateMockTaxpayer(cleanedNin);
    return {
      ok: true,
      message: 'Verified (Simulated Demo Sandbox)',
      data,
      durationMs,
      isDemoSimulation: true,
      source: 'Simulated Demo Sandbox',
    };
  }

  // 2. REAL VERIFICATION VIA RELAY / BACKEND PROXY (Server-Side Proxy CORS Bypass)
  if (proxyUrl && proxyUrl.trim() !== '') {
    try {
      const pController = new AbortController();
      const pTimer = setTimeout(() => pController.abort(), 25000);
      let endpoint = proxyUrl.trim();
      if (!endpoint.endsWith('/api/verify') && !endpoint.endsWith('/verify') && !endpoint.endsWith('/validate')) {
        endpoint = `${endpoint.replace(/\/$/, '')}/api/verify`;
      }

      const pRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nin: cleanedNin,
          merchantKey: merchantKey.trim(),
          gatewayUrl: gatewayUrl || DEFAULT_GATEWAY_URL,
          isDemo: false,
        }),
        signal: pController.signal,
      });
      clearTimeout(pTimer);

      const durationMs = Math.round(performance.now() - start);
      const json = await pRes.json().catch(() => null);

      if (pRes.ok && json) {
        // Universal detection across Node.js, Python FastAPI, Go, Vercel, Cloudflare, and raw BIRS JSON:
        const isSuccess =
          json.status === 'success' ||
          json.status === true ||
          json.ok === true ||
          json.code === 200 ||
          Boolean(json.details && Object.keys(json.details).length > 0 && !json.details.error) ||
          Boolean(json.data && (json.data.firstName || json.data['First Name'] || json.data.nin)) ||
          Boolean(json.firstName || json.surname || json['First Name'] || json['Surname']);

        if (isSuccess) {
          const raw = json.details || json.data || json;
          const flat = flattenJson(raw);
          if (!flat['NIN']) flat['NIN'] = cleanedNin;
          return {
            ok: true,
            message: json.message || 'Verified successfully via Live BIRS Gateway',
            data: flat,
            durationMs,
            source: 'BIRS Live Gateway (via Server Proxy)',
          };
        } else {
          const errMsg = json.message || json.error || json.errorDescription || 'Verification failed on BIRS gateway';
          return {
            ok: false,
            message: errMsg,
            data: json.details || json.data || json || {},
            durationMs,
            source: 'BIRS Live Gateway (via Server Proxy)',
          };
        }
      } else if (json && (json.message || json.error)) {
        return {
          ok: false,
          message: json.message || json.error,
          data: json.details || {},
          durationMs,
          source: 'BIRS Live Gateway (via Server Proxy)',
        };
      }
    } catch (proxyErr: any) {
      // If explicit proxy fails, fall through only if network error, but log
      console.warn('Configured proxy request error:', proxyErr);
    }
  }

  // 3. REAL VERIFICATION VIA CHROME EXTENSION BRIDGE
  if (isExtensionBridgeAvailable()) {
    try {
      const extRes = await verifyViaExtension(cleanedNin, merchantKey);
      if (extRes.ok || extRes.message) {
        return extRes;
      }
    } catch {
      // Fall through to direct fetch
    }
  }

  // 4. REAL LIVE BIRS GATEWAY CALL (Direct to service-gateway.bsg.com.ng)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    const res = await fetch(gatewayUrl || DEFAULT_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': merchantKey.trim(),
      },
      body: JSON.stringify({ nin: cleanedNin }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const durationMs = Math.round(performance.now() - start);
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
      if (!details['NIN']) details['NIN'] = cleanedNin;
      return {
        ok: true,
        message: 'Verified successfully via Live BIRS Gateway',
        data: details,
        durationMs,
        source: 'BIRS Live Gateway (Direct)',
      };
    }

    const errorMsg = extractErrorMessage(json, res.status);
    return {
      ok: false,
      message: errorMsg,
      data: json || {},
      durationMs,
      source: 'BIRS Live Gateway (Direct)',
    };
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - start);
    let msg = err?.message || 'Network request failed';
    const isCors =
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('CORS') ||
      err?.name === 'TypeError';

    if (err?.name === 'AbortError') {
      msg = 'Gateway Timeout: BIRS portal took longer than 25s to respond.';
    } else if (isCors) {
      msg = `Browser CORS blocked direct gateway access: service-gateway.bsg.com.ng does not allow direct cross-origin browser requests from static origins like github.io. Open direct page: ${BIRS_DIRECT_PORTAL_URL}`;
    }

    return {
      ok: false,
      message: msg,
      durationMs,
      isCorsBlocked: isCors,
      source: 'Live Gateway (Direct)',
    };
  }
}

// Client-Side Bot Queue Runner
export class ClientBotManager {
  private activeJobs: Map<string, { paused: boolean; stopped: boolean }> = new Map();
  private onUpdate: (job: BotJob) => void;

  constructor(onUpdate: (job: BotJob) => void) {
    this.onUpdate = onUpdate;
  }

  pauseJob(jobId: string) {
    const j = this.activeJobs.get(jobId);
    if (j) j.paused = true;
  }

  resumeJob(jobId: string) {
    const j = this.activeJobs.get(jobId);
    if (j) j.paused = false;
  }

  stopJob(jobId: string) {
    const j = this.activeJobs.get(jobId);
    if (j) j.stopped = true;
  }

  async runJob(job: BotJob) {
    const state = { paused: false, stopped: false };
    this.activeJobs.set(job.id, state);

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    this.addLog(
      job,
      'info',
      `🚀 Bot started for ${job.totalNins} NINs [${job.settings.isDemo ? 'Sandbox Engine' : 'Live Gateway Real Verification'}]`
    );
    this.onUpdate({ ...job });

    const queue = [...job.queue];
    const concurrency = Math.max(1, Math.min(job.settings.concurrency || 1, 5));
    let activeWorkers = 0;

    const processNext = async () => {
      if (state.stopped) return;

      while (state.paused) {
        if (state.stopped) return;
        await new Promise((r) => setTimeout(r, 400));
      }

      if (queue.length === 0) return;

      const nin = queue.shift()!;
      job.queue = [...queue];
      job.inFlight.push(nin);
      this.onUpdate({ ...job });

      let attempts = 0;
      let success = false;
      let lastMessage = '';
      let taxpayerData: any = null;
      let totalDuration = 0;
      let isCorsBlocked = false;
      let verificationSource = '';

      while (attempts <= (job.settings.autoRetry ? job.settings.maxRetries : 0) && !success && !state.stopped) {
        attempts++;
        if (attempts > 1) {
          job.stats.retries++;
          this.addLog(job, 'warn', `Retry attempt ${attempts}/${job.settings.maxRetries + 1} for ${nin}`, nin);
          this.onUpdate({ ...job });
          await new Promise((r) => setTimeout(r, 1000));
        }

        const res = await verifyNinInBrowser(
          nin,
          job.settings.merchantKey,
          job.settings.gatewayUrl,
          job.settings.isDemo,
          job.settings.proxyUrl
        );

        totalDuration += res.durationMs;
        lastMessage = res.message;
        isCorsBlocked = Boolean(res.isCorsBlocked);
        verificationSource = res.source || '';

        if (res.ok) {
          success = true;
          taxpayerData = res.data;
        } else {
          // If non-recoverable error (e.g. not found or CORS), do not loop retry
          if (res.message.includes('not found') || res.message.includes('Invalid NIN') || res.isCorsBlocked) {
            break;
          }
        }
      }

      // Record result (strictly genuine, never faked)
      const verifiedResult: VerificationResult = {
        nin,
        status: success ? 'success' : 'failed',
        message: lastMessage,
        details: taxpayerData || {},
        verifiedAt: new Date().toISOString(),
        attempts,
        durationMs: totalDuration,
        isCorsBlocked,
        isDemoSimulation: job.settings.isDemo,
        source: verificationSource,
      };

      job.results.unshift(verifiedResult);
      job.inFlight = job.inFlight.filter((n: string) => n !== nin);
      job.stats.processed++;
      if (success) {
        job.stats.success++;
        const name = taxpayerData ? `${taxpayerData['First Name'] || ''} ${taxpayerData['Surname'] || ''}`.trim() : '';
        this.addLog(job, 'success', `Verified ${nin} ${name ? `(${name})` : ''}`, nin);
      } else {
        job.stats.failed++;
        this.addLog(job, 'error', `Failed ${nin}: ${lastMessage}`, nin);
      }

      // Update avg duration
      job.stats.avgTimeMs = Math.round(
        job.results.reduce((acc: number, r: VerificationResult) => acc + r.durationMs, 0) / Math.max(1, job.results.length)
      );

      this.onUpdate({ ...job });

      // Apply delay & jitter before next NIN
      const delay = Math.max(0, job.settings.delayMs || 0);
      const jitter = Math.floor(Math.random() * (job.settings.jitterMs || 0));
      if (delay + jitter > 0 && queue.length > 0) {
        await new Promise((r) => setTimeout(r, delay + jitter));
      }
    };

    const worker = async () => {
      activeWorkers++;
      while (queue.length > 0 && !state.stopped) {
        await processNext();
      }
      activeWorkers--;
      if (activeWorkers === 0) {
        job.status = state.stopped ? 'stopped' : 'completed';
        job.completedAt = new Date().toISOString();
        this.addLog(job, 'info', `🏁 Bot job completed. Total verified: ${job.stats.success}/${job.stats.total}`);
        this.onUpdate({ ...job });
      }
    };

    const workerPromises = [];
    for (let i = 0; i < concurrency; i++) {
      workerPromises.push(worker());
    }
  }

  private addLog(job: BotJob, level: BotLog['level'], message: string, nin?: string) {
    const log: BotLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      nin,
    };
    job.logs.unshift(log);
    if (job.logs.length > 500) {
      job.logs = job.logs.slice(0, 500);
    }
  }
}

// Client-Side Excel / CSV Exporter
export function exportResultsInBrowser(
  job: BotJob,
  format: 'xlsx' | 'csv' = 'xlsx',
  filter: 'all' | 'success' = 'all'
) {
  const filtered = filter === 'success'
    ? job.results.filter((r) => r.status === 'success')
    : job.results;

  if (filtered.length === 0) {
    throw new Error('No records match the selected export filter.');
  }

  const rows = filtered.map((r) => {
    const base: Record<string, any> = {
      'NIN': r.nin,
      'Status': r.status.toUpperCase(),
      'Message': r.message,
      'Verification Date': r.verifiedAt,
      'Response Time (ms)': r.durationMs,
      'Attempts': r.attempts,
    };

    if (r.details && typeof r.details === 'object') {
      for (const [k, v] of Object.entries(r.details)) {
        if (k !== 'NIN' && typeof v !== 'object') {
          base[k] = v;
        }
      }
    }
    return base;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'BIRS NIN Results');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `birs_nin_verified_${job.id}_${filter}_${timestamp}.${format}`;

  if (format === 'csv') {
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    downloadBlob(csvContent, filename, 'text/csv;charset=utf-8;');
  } else {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob(wbout, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
}

// Client-Side Standalone Python Bot Script Generator
export function downloadPythonBotScript() {
  const pythonScript = `#!/usr/bin/env python3
"""
BIRS Autonomous NIN Bulk Verification Bot (Standalone Engine)
Direct gateway access - runs locally with 100% genuine validation and zero browser CORS limits.
"""

import sys
import time
import argparse
import requests
import openpyxl
from openpyxl import Workbook

DEFAULT_GATEWAY = "https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate"
DEFAULT_KEY = "e6385c73adba4eb6807c0ec858fd8f5c"

def verify_nin(nin, merchant_key=DEFAULT_KEY, gateway=DEFAULT_GATEWAY, timeout=25):
    headers = {
        "Content-Type": "application/json",
        "X-MERCHANT-KEY": merchant_key,
        "User-Agent": "Mozilla/5.0 BIRSBot/2.2",
        "Origin": "https://birs.be.gov.ng",
        "Referer": "https://birs.be.gov.ng/",
    }
    try:
        resp = requests.post(gateway, json={"nin": str(nin).strip()}, headers=headers, timeout=timeout)
        try:
            data = resp.json()
        except Exception:
            data = {}
        if resp.status_code == 200 and data:
            return True, "Verified successfully", data
        error_msg = data.get("message") or data.get("error") or f"HTTP {resp.status_code}"
        return False, error_msg, data
    except Exception as e:
        return False, f"Network error: {str(e)}", {}

def main():
    parser = argparse.ArgumentParser(description="BIRS NIN Bulk Verification Bot")
    parser.add_argument("--input", "-i", required=True, help="Path to input XLSX or TXT file containing NINs")
    parser.add_argument("--output", "-o", default="birs_verified_results.xlsx", help="Output XLSX file path")
    parser.add_argument("--delay", "-d", type=float, default=1.5, help="Delay between requests in seconds")
    parser.add_argument("--key", "-k", default=DEFAULT_KEY, help="BIRS Merchant Key")
    args = parser.parse_args()

    nins = []
    if args.input.endswith((".xlsx", ".xls")):
        wb_in = openpyxl.load_workbook(args.input, data_only=True)
        sheet = wb_in.active
        for row in sheet.iter_rows(values_only=True):
            for cell in row:
                s = str(cell or "").strip()
                if len(s) == 11 and s.isdigit():
                    nins.append(s)
    else:
        with open(args.input, "r") as f:
            for line in f:
                s = line.strip()
                if len(s) == 11 and s.isdigit():
                    nins.append(s)

    nins = sorted(list(set(nins)))
    print(f"[*] Loaded {len(nins)} unique 11-digit NINs to verify against BIRS Gateway.")

    wb_out = Workbook()
    ws_success = wb_out.active
    ws_success.title = "Verified Taxpayers"
    ws_all = wb_out.create_sheet(title="All Results")
    ws_all.append(["NIN", "Status", "Message"])

    successes = []
    for idx, nin in enumerate(nins, 1):
        print(f"[{idx}/{len(nins)}] Verifying {nin}... ", end="", flush=True)
        ok, msg, data = verify_nin(nin, merchant_key=args.key)
        if ok:
            name = f"{data.get('firstName', '')} {data.get('surname', '')}".strip()
            print(f"SUCCESS: {name or 'OK'}")
            row = {"NIN": nin, **data}
            successes.append(row)
            ws_all.append([nin, "SUCCESS", msg])
        else:
            print(f"FAILED ({msg})")
            ws_all.append([nin, "FAILED", msg])
        if idx < len(nins):
            time.sleep(args.delay)

    if successes:
        headers = list(successes[0].keys())
        ws_success.append(headers)
        for s in successes:
            ws_success.append([str(s.get(h, "")) for h in headers])
    else:
        ws_success.append(["NIN", "Status"])
        ws_success.append(["None", "No successful verifications"])

    wb_out.save(args.output)
    print(f"[+] All done! Results saved to {args.output}")

if __name__ == "__main__":
    main()
`;
  downloadBlob(pythonScript, 'birs_bot.py', 'text/x-python');
}

// Client-Side Standalone Node.js Bot Downloader
export function downloadNodeBotScript() {
  const nodeScript = `// BIRS Autonomous NIN Bulk Verification Bot (Node.js Standalone)
import fs from 'fs';
import * as XLSX from 'xlsx';

const DEFAULT_GATEWAY = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

const inputFile = process.argv[2] || 'nins.xlsx';
const outputFile = process.argv[3] || 'birs_verified.xlsx';
const delay = Number(process.argv[4]) || 1500;

if (!fs.existsSync(inputFile)) {
  console.error('[!] Input file not found:', inputFile);
  console.log('Usage: node birs_nin_bot.mjs <input.xlsx/txt> [output.xlsx] [delayMs]');
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
  nins = text.match(/\\b\\d{11}\\b/g) || [];
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
        'User-Agent': 'Mozilla/5.0 BIRSBot/2.2',
        'Origin': 'https://birs.be.gov.ng',
        'Referer': 'https://birs.be.gov.ng/',
      },
      body: JSON.stringify({ nin }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      return { ok: true, data: json };
    }
    return { ok: false, message: json.message || json.error || \`HTTP \${res.status}\` };
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
  downloadBlob(nodeScript, 'birs_nin_bot.mjs', 'text/javascript');
}

// Client-Side Full Manifest V3 Chrome Extension Downloader
export async function downloadExtensionZip() {
  const zip = new JSZip();

  const manifest = {
    manifest_version: 3,
    name: "BIRS NIN Live Verifier & Autonomous Bot",
    version: "2.2.0",
    description: "Bypasses browser CORS to perform real, live verification of Nigerian NINs against the official BIRS Gateway.",
    permissions: ["storage"],
    host_permissions: [
      "*://service-gateway.bsg.com.ng/*",
      "*://birs.be.gov.ng/*"
    ],
    background: {
      service_worker: "background.js"
    },
    content_scripts: [
      {
        matches: [
          "*://elight2026.github.io/*",
          "*://*.github.io/*",
          "*://localhost/*",
          "*://127.0.0.1/*"
        ],
        js: ["content.js"],
        run_at: "document_start"
      }
    ],
    action: {
      default_popup: "popup.html",
      default_title: "BIRS NIN Live Verifier Bot"
    }
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // Background Service Worker with host_permissions (NO CORS restrictions)
  const backgroundJs = `// BIRS Background Service Worker - Native Gateway Proxy
const DEFAULT_GATEWAY = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

async function verifyNin(nin, merchantKey = DEFAULT_KEY, gateway = DEFAULT_GATEWAY) {
  try {
    const res = await fetch(gateway, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': merchantKey,
        'Origin': 'https://birs.be.gov.ng',
        'Referer': 'https://birs.be.gov.ng/',
      },
      body: JSON.stringify({ nin: String(nin).trim() }),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch {}

    if (res.ok && json) {
      return { ok: true, data: json };
    }
    const msg = json.message || json.error || \`HTTP \${res.status}\`;
    return { ok: false, message: msg, data: json };
  } catch (err) {
    return { ok: false, message: err.message || 'Network request failed' };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'VERIFY_NIN') {
    verifyNin(request.nin, request.merchantKey, request.gateway).then(sendResponse);
    return true; // Keep channel open for async response
  }
});
`;
  zip.file("background.js", backgroundJs);

  // Content script that injects extension bridge into web page
  const contentJs = `// Injects bridge into elight2026.github.io and localhost
window.__BIRS_EXTENSION_AVAILABLE__ = true;
window.postMessage({ type: 'BIRS_EXTENSION_READY' }, '*');

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'BIRS_PAGE_VERIFY_REQUEST') {
    chrome.runtime.sendMessage({
      action: 'VERIFY_NIN',
      nin: event.data.nin,
      merchantKey: event.data.merchantKey,
    }, (result) => {
      window.postMessage({
        type: 'BIRS_PAGE_VERIFY_RESPONSE',
        id: event.data.id,
        result: result || { ok: false, message: 'Extension communication error' },
      }, '*');
    });
  }
});
`;
  zip.file("content.js", contentJs);

  // Full-featured Popup UI
  const popupHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BIRS NIN Real Verifier Bot</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; width: 360px; padding: 14px; background: #090d16; color: #f1f5f9; margin: 0; box-sizing: border-box; }
    h1 { font-size: 14px; margin: 0 0 4px 0; color: #10b981; display: flex; align-items: center; gap: 6px; }
    .badge { font-size: 10px; background: #064e3b; color: #34d399; padding: 2px 6px; border-radius: 4px; font-weight: normal; }
    p { font-size: 11px; color: #94a3b8; line-height: 1.3; margin: 0 0 10px 0; }
    label { font-size: 11px; font-weight: 600; color: #cbd5e1; display: block; margin-top: 8px; margin-bottom: 4px; }
    input, textarea { width: 100%; background: #131b2e; border: 1px solid #1e293b; border-radius: 6px; color: #fff; padding: 6px 8px; font-family: monospace; font-size: 11px; box-sizing: border-box; }
    textarea { height: 75px; resize: none; }
    input:focus, textarea:focus { outline: none; border-color: #10b981; }
    .btn-row { display: flex; gap: 6px; margin-top: 10px; }
    button { flex: 1; background: #059669; color: white; border: none; padding: 8px; border-radius: 6px; font-weight: 600; font-size: 11px; cursor: pointer; transition: background 0.15s; }
    button:hover { background: #10b981; }
    button.secondary { background: #1e293b; color: #cbd5e1; }
    button.secondary:hover { background: #334155; }
    #stats { margin-top: 10px; padding: 8px; background: #131b2e; border-radius: 6px; font-size: 11px; display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; gap: 4px; }
    #stats div span { display: block; font-size: 14px; font-weight: bold; }
    #stats .s-ok { color: #34d399; }
    #stats .s-err { color: #f87171; }
    #log { margin-top: 10px; height: 120px; overflow-y: auto; background: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 6px; font-family: monospace; font-size: 10px; line-height: 1.4; color: #94a3b8; }
    .log-ok { color: #34d399; }
    .log-err { color: #f87171; }
  </style>
</head>
<body>
  <h1>BIRS Live Verifier <span class="badge">No CORS</span></h1>
  <p>Real-time verification directly against official BIRS Gateway.</p>
  
  <label>Merchant Key:</label>
  <input type="text" id="mKey" value="e6385c73adba4eb6807c0ec858fd8f5c" />

  <label>Paste 11-digit NINs:</label>
  <textarea id="nins" placeholder="38472910485&#10;59382019482..."></textarea>

  <div class="btn-row">
    <button id="startBtn">Verify NINs</button>
    <button id="stopBtn" class="secondary">Stop</button>
  </div>

  <div id="stats">
    <div>Total: <span id="statTotal">0</span></div>
    <div>Verified: <span id="statOk" class="s-ok">0</span></div>
    <div>Failed: <span id="statErr" class="s-err">0</span></div>
  </div>

  <div id="log">Ready to verify.</div>

  <div class="btn-row" style="margin-top: 8px;">
    <button id="exportBtn" class="secondary">Export Verified (.csv)</button>
  </div>

  <script src="popup.js"></script>
</body>
</html>`;
  zip.file("popup.html", popupHtml);

  // Popup verification runner
  const popupJs = `const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');
const ninsEl = document.getElementById('nins');
const mKeyEl = document.getElementById('mKey');
const statTotal = document.getElementById('statTotal');
const statOk = document.getElementById('statOk');
const statErr = document.getElementById('statErr');
const logEl = document.getElementById('log');

let isRunning = false;
let verifiedRecords = [];

function appendLog(text, cls = '') {
  const p = document.createElement('div');
  if (cls) p.className = cls;
  p.textContent = text;
  logEl.appendChild(p);
  logEl.scrollTop = logEl.scrollHeight;
}

startBtn.addEventListener('click', async () => {
  if (isRunning) return;
  const text = ninsEl.value;
  const matches = text.match(/\\b\\d{11}\\b/g) || [];
  const unique = [...new Set(matches)];

  if (unique.length === 0) {
    alert('Please enter at least one valid 11-digit NIN.');
    return;
  }

  isRunning = true;
  verifiedRecords = [];
  statTotal.textContent = unique.length;
  statOk.textContent = '0';
  statErr.textContent = '0';
  logEl.innerHTML = '';
  appendLog('Starting live verification for ' + unique.length + ' NINs...');

  const key = mKeyEl.value.trim();

  for (let i = 0; i < unique.length; i++) {
    if (!isRunning) break;
    const nin = unique[i];
    appendLog('[' + (i + 1) + '/' + unique.length + '] Verifying ' + nin + '...');

    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'VERIFY_NIN',
        nin,
        merchantKey: key
      }, resolve);
    });

    if (res && res.ok) {
      statOk.textContent = Number(statOk.textContent) + 1;
      const fn = res.data?.firstName || '';
      const sn = res.data?.surname || '';
      appendLog('✓ Verified: ' + nin + (fn ? ' (' + fn + ' ' + sn + ')' : ''), 'log-ok');
      verifiedRecords.push({ NIN: nin, ...res.data });
    } else {
      statErr.textContent = Number(statErr.textContent) + 1;
      appendLog('✗ Failed: ' + (res?.message || 'Gateway error'), 'log-err');
    }

    if (i < unique.length - 1) {
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  isRunning = false;
  appendLog('Complete! Total verified: ' + statOk.textContent + '/' + unique.length);
});

stopBtn.addEventListener('click', () => {
  isRunning = false;
  appendLog('Stopped by user.');
});

exportBtn.addEventListener('click', () => {
  if (verifiedRecords.length === 0) {
    alert('No verified records to export yet.');
    return;
  }
  const headers = Object.keys(verifiedRecords[0]);
  const rows = [headers.join(',')];
  for (const r of verifiedRecords) {
    rows.push(headers.map(h => JSON.stringify(r[h] || '')).join(','));
  }
  const blob = new Blob([rows.join('\\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'birs_verified_' + Date.now() + '.csv';
  a.click();
});
`;
  zip.file("popup.js", popupJs);

  const readme = `BIRS NIN Autonomous Verifier Chrome Extension v2.2
==================================================

Why this extension:
Browsers enforce Cross-Origin Resource Sharing (CORS) on static websites like GitHub Pages.
This Chrome Extension uses host_permissions to connect directly to the BIRS Gateway (service-gateway.bsg.com.ng)
with zero CORS blocking, giving you 100% genuine taxpayer verification.

How to install:
1. Extract/unzip this folder to your computer.
2. Open Google Chrome (or Edge / Brave).
3. Navigate to: chrome://extensions/
4. Turn on "Developer mode" (toggle switch at top right).
5. Click "Load unpacked" (top left button).
6. Select the unzipped folder.

Usage:
- Click the BIRS icon in your Chrome toolbar to verify NINs in bulk.
- If you open https://elight2026.github.io/birm/, this extension automatically bridges the website to perform live real verifications with zero CORS errors!
`;
  zip.file("README.txt", readme);

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "birs_nin_live_extension_v2.2.zip", "application/zip");
}

function downloadBlob(content: BlobPart, filename: string, mimeType: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Tests connection and measures latency to a Server-Side Proxy
 * Compatible with Node.js, Python FastAPI, Go, Vercel, and Cloudflare proxies.
 */
export async function testProxyConnection(
  url: string,
  key: string = DEFAULT_MERCHANT_KEY
): Promise<{
  ok: boolean;
  latencyMs: number;
  message: string;
  endpointTested: string;
  details?: any;
}> {
  const cleanUrl = url.trim().replace(/\/$/, '');
  if (!cleanUrl) {
    return {
      ok: false,
      latencyMs: 0,
      message: 'Proxy URL is empty. Please enter a valid URL (e.g. https://my-birs-proxy.onrender.com or http://localhost:3000).',
      endpointTested: '',
    };
  }

  // Detect static GitHub Pages entered by mistake
  if (cleanUrl.includes('github.io')) {
    return {
      ok: false,
      latencyMs: 0,
      message: 'GitHub Pages (github.io) is a static hosting platform and cannot run a server-side proxy (it rejects POST with HTTP 405 Method Not Allowed). Please deploy the proxy on a backend platform like Render.com (free), Vercel, Railway, or your local Node.js server (http://localhost:3000).',
      endpointTested: cleanUrl,
    };
  }

  const start = performance.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    // Compute both endpoint variants
    const baseUrl = cleanUrl.replace(/\/api\/verify\/?$/, '').replace(/\/verify\/?$/, '').replace(/\/api\/health\/?$/, '').replace(/\/$/, '');
    const verifyUrl = cleanUrl.endsWith('/api/verify') || cleanUrl.endsWith('/verify')
      ? cleanUrl
      : `${baseUrl}/api/verify`;
    const healthUrl = `${baseUrl}/api/health`;

    let res: Response | null = null;
    let endpointUsed = verifyUrl;

    // 1. Primary Test: Send test verification POST directly to /api/verify
    try {
      res = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nin: '12345678901', merchantKey: key }),
        signal: controller.signal,
      });
      endpointUsed = verifyUrl;
    } catch {
      res = null;
    }

    // 2. If POST returned 404 or 405, try root POST (e.g. Cloudflare Worker or single-route proxy)
    if (!res || res.status === 404 || res.status === 405) {
      try {
        const rootRes = await fetch(baseUrl || cleanUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nin: '12345678901', merchantKey: key }),
          signal: controller.signal,
        });
        if (rootRes && (rootRes.ok || rootRes.status === 400)) {
          res = rootRes;
          endpointUsed = baseUrl || cleanUrl;
        }
      } catch {
        // ignore
      }
    }

    // 3. If POST failed or wasn't accepted, try GET /api/health or GET /api/verify
    if (!res || (!res.ok && res.status !== 400)) {
      try {
        const getRes = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
        if (getRes && getRes.ok) {
          res = getRes;
          endpointUsed = healthUrl;
        } else {
          const verifyGet = await fetch(verifyUrl, { method: 'GET', signal: controller.signal });
          if (verifyGet && verifyGet.ok) {
            res = verifyGet;
            endpointUsed = verifyUrl;
          }
        }
      } catch {
        // ignore
      }
    }

    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - start);

    if (res && (res.ok || res.status === 400 || res.status === 200)) {
      const json = await res.json().catch(() => ({}));
      return {
        ok: true,
        latencyMs,
        message: `Proxy online! Connection verified in ${latencyMs}ms. CORS restrictions bypassed successfully.`,
        endpointTested: endpointUsed,
        details: json,
      };
    }

    if (res && res.status === 405) {
      return {
        ok: false,
        latencyMs,
        message: `Server reached (${latencyMs}ms) but returned HTTP 405 Method Not Allowed. The URL "${endpointUsed}" rejected POST requests. If this is a static hosting URL (like GitHub Pages or Cloudflare Pages), deploy the proxy to a real backend host like Render.com (free) or Vercel. If this is a custom server, ensure POST is accepted on /api/verify.`,
        endpointTested: endpointUsed,
      };
    }

    return {
      ok: false,
      latencyMs,
      message: res
        ? `Server reached (${latencyMs}ms) but returned HTTP ${res.status}. Verify endpoint configuration.`
        : 'Could not connect to proxy server. Check that your backend (Render/Vercel/AWS) is active and CORS is enabled.',
      endpointTested: endpointUsed,
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      ok: false,
      latencyMs,
      message: err?.name === 'AbortError' ? 'Proxy test timed out (12s). The server took too long to reply.' : `Connection failed: ${err?.message || String(err)}`,
      endpointTested: cleanUrl,
    };
  }
}

// Client-Side Standalone Node.js Proxy Script Downloader
export function downloadNodeProxyScript() {
  const code = `/**
 * Standalone Node.js Express Proxy for BIRS NIN Gateway
 * Deploy on Render (Free), Railway, Replit, or run locally:
 * 
 * 1. npm init -y
 * 2. npm install express cors
 * 3. node server.js
 */

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_GATEWAY = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-MERCHANT-KEY', 'Authorization'] }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'BIRS Node.js Proxy', message: 'Ready for GitHub Pages requests' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post(['/api/verify', '/api/validate', '/api/proxy'], async (req, res) => {
  const { nin, merchantKey, gatewayUrl } = req.body || {};
  const cleanedNin = String(nin || '').replace(/\\D/g, '');

  if (cleanedNin.length !== 11) {
    return res.status(400).json({ status: 'failed', message: 'NIN must be 11 digits', details: {} });
  }

  const targetUrl = gatewayUrl || DEFAULT_GATEWAY;
  const key = (merchantKey || DEFAULT_KEY).trim();

  try {
    const birsRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': key,
        'Origin': 'https://birs.be.gov.ng',
        'Referer': 'https://birs.be.gov.ng/',
        'User-Agent': 'Mozilla/5.0 BIRSProxy/3.0',
      },
      body: JSON.stringify({ nin: cleanedNin }),
    });

    const data = await birsRes.json().catch(() => ({}));
    if (birsRes.ok) {
      return res.status(200).json({
        status: 'success',
        ok: true,
        message: 'Verified successfully via Live BIRS Gateway',
        details: data,
        data: data,
      });
    }

    return res.status(birsRes.status).json({
      status: 'failed',
      ok: false,
      message: data.message || 'Verification failed on BIRS gateway',
      details: data,
    });
  } catch (err) {
    return res.status(500).json({ status: 'failed', message: err.message, details: {} });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`[BIRS Proxy] listening on http://0.0.0.0:\${PORT}\`);
});
`;
  downloadBlob(code, 'birs_node_proxy.js', 'text/javascript');
}

// Client-Side Standalone Python Proxy Script Downloader
export function downloadPythonProxyScript() {
  const code = `"""
BIRS NIN Gateway - Python FastAPI Server-Side Proxy
Deploy on Render (Free), AWS, Railway, or run locally:
pip install fastapi uvicorn httpx
python app.py
"""

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
import httpx
import uvicorn
import re
import os

app = FastAPI(title="BIRS NIN Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_GATEWAY = "https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate"
DEFAULT_KEY = "e6385c73adba4eb6807c0ec858fd8f5c"

@app.get("/")
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "BIRS Python Proxy"}

@app.post("/api/verify")
@app.post("/api/validate")
@app.post("/api/proxy")
async def verify(request: Request):
    body = await request.json()
    nin = re.sub(r"\\D", "", str(body.get("nin", "")))
    if len(nin) != 11:
        return Response(content='{"status":"failed","message":"NIN must be 11 digits"}', status_code=400, media_type="application/json")
    
    key = str(body.get("merchantKey") or DEFAULT_KEY).strip()
    url = str(body.get("gatewayUrl") or DEFAULT_GATEWAY)

    headers = {
        "Content-Type": "application/json",
        "X-MERCHANT-KEY": key,
        "Origin": "https://birs.be.gov.ng",
        "Referer": "https://birs.be.gov.ng/",
        "User-Agent": "Mozilla/5.0 BIRSProxy-Python/1.0"
    }

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(url, headers=headers, json={"nin": nin})
            data = resp.json() if resp.status_code == 200 else {}
            if resp.status_code == 200:
                return {"status": "success", "ok": True, "details": data, "data": data}
            return Response(content=resp.text, status_code=resp.status_code, media_type="application/json")
    except Exception as e:
        return Response(content=f'{{"status":"failed","message":"{str(e)}"}}', status_code=500, media_type="application/json")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
`;
  downloadBlob(code, 'birs_python_proxy.py', 'text/x-python');
}

// Client-Side Standalone Go Proxy Script Downloader
export function downloadGoProxyScript() {
  const code = `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"time"
)

const (
	defaultGateway = "https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate"
	defaultKey     = "e6385c73adba4eb6807c0ec858fd8f5c"
)

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-MERCHANT-KEY, Authorization")
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(\`{"status":"ok","service":"BIRS Go Proxy"}\`))
	})

	http.HandleFunc("/api/verify", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, \`{"error":"Method not allowed"}\`, http.StatusMethodNotAllowed)
			return
		}

		var reqData struct {
			NIN         string \`json:"nin"\`
			MerchantKey string \`json:"merchantKey"\`
		}
		bodyBytes, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(bodyBytes, &reqData)

		cleaned := regexp.MustCompile(\`\\D\`).ReplaceAllString(reqData.NIN, "")
		if len(cleaned) != 11 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(\`{"status":"failed","message":"NIN must be 11 digits"}\`))
			return
		}

		key := reqData.MerchantKey
		if key == "" {
			key = defaultKey
		}

		payload, _ := json.Marshal(map[string]string{"nin": cleaned})
		client := &http.Client{Timeout: 25 * time.Second}
		bReq, _ := http.NewRequest(http.MethodPost, defaultGateway, bytes.NewBuffer(payload))
		bReq.Header.Set("Content-Type", "application/json")
		bReq.Header.Set("X-MERCHANT-KEY", key)
		bReq.Header.Set("Origin", "https://birs.be.gov.ng")
		bReq.Header.Set("Referer", "https://birs.be.gov.ng/")

		resp, err := client.Do(bReq)
		if err != nil {
			http.Error(w, fmt.Sprintf(\`{"status":"failed","message":"%s"}\`, err.Error()), http.StatusGatewayTimeout)
			return
		}
		defer resp.Body.Close()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})

	log.Printf("[BIRS Go Proxy] listening on :%s", port)
	http.ListenAndServe(":"+port, nil)
}
`;
  downloadBlob(code, 'birs_go_proxy.go', 'text/x-go');
}

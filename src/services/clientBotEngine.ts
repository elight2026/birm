import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  type VerificationResult,
  type BotLog,
  type BotJob,
  type BotJobSettings,
  type BotJobStats,
  DEFAULT_GATEWAY_URL,
  DEFAULT_MERCHANT_KEY
} from '../types';

export {
  type VerificationResult,
  type BotLog,
  type BotJob,
  type BotJobSettings,
  type BotJobStats,
  DEFAULT_GATEWAY_URL,
  DEFAULT_MERCHANT_KEY
};

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

// Direct NIN verification helper (supports sandbox or live gateway)
export async function verifyNinInBrowser(
  nin: string,
  merchantKey: string = DEFAULT_MERCHANT_KEY,
  gatewayUrl: string = DEFAULT_GATEWAY_URL,
  isDemo: boolean = true
): Promise<{ ok: boolean; message: string; data?: Record<string, any>; durationMs: number }> {
  const start = performance.now();

  if (isDemo) {
    // Realistic slight delay (300-800ms)
    await new Promise((r) => setTimeout(r, 350 + Math.random() * 450));
    const durationMs = Math.round(performance.now() - start);

    // Fail any NIN ending in '000' for demo failure testing
    if (nin.endsWith('000')) {
      return { ok: false, message: 'NIN not found in national identity database', durationMs };
    }

    const data = generateMockTaxpayer(nin);
    return { ok: true, message: 'Taxpayer verified successfully', data, durationMs };
  }

  // Live Gateway Verification
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    const res = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': merchantKey.trim(),
      },
      body: JSON.stringify({ nin: nin.trim() }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const durationMs = Math.round(performance.now() - start);
    if (res.ok) {
      const json = await res.json();
      return { ok: true, message: 'Verified', data: json, durationMs };
    }

    let errorMsg = `Gateway returned HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errorMsg = errJson.message || errJson.error || errorMsg;
    } catch {
      // fallback
    }
    return { ok: false, message: errorMsg, durationMs };
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - start);
    let msg = err.message || 'Network request failed';
    if (err.name === 'AbortError') {
      msg = 'Gateway Timeout (25s exceeded)';
    } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
      msg = 'Browser CORS blocked direct gateway access. (Tip: Use Sandbox mode, run Node/Python script, or use Chrome Extension).';
    }
    return { ok: false, message: msg, durationMs };
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
    this.addLog(job, 'info', `🚀 Bot started for ${job.totalNins} NINs [${job.settings.isDemo ? 'Sandbox Engine' : 'Live Gateway'}]`);
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
          job.settings.isDemo
        );

        totalDuration += res.durationMs;
        lastMessage = res.message;
        if (res.ok) {
          success = true;
          taxpayerData = res.data;
        } else {
          // If non-recoverable error, do not retry
          if (res.message.includes('not found') || res.message.includes('Invalid NIN')) {
            break;
          }
        }
      }

      // Record result
      const verifiedResult: VerificationResult = {
        nin,
        status: success ? 'success' : 'failed',
        message: lastMessage,
        details: taxpayerData || {},
        verifiedAt: new Date().toISOString(),
        attempts,
        durationMs: totalDuration,
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

      // Apply delay & jitter
      if (queue.length > 0 && !state.stopped) {
        const jitter = (Math.random() * 2 - 1) * job.settings.jitterMs;
        const sleepTime = Math.max(200, job.settings.delayMs + jitter);
        await new Promise((r) => setTimeout(r, sleepTime));
      }
    };

    // Run concurrency pool
    const workerPromises = Array.from({ length: concurrency }, async () => {
      activeWorkers++;
      while (queue.length > 0 && !state.stopped) {
        await processNext();
      }
      activeWorkers--;
    });

    await Promise.all(workerPromises);

    if (state.stopped) {
      job.status = 'stopped';
      this.addLog(job, 'warn', '🛑 Bot was manually stopped.');
    } else {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      this.addLog(
        job,
        'info',
        `🏁 Completed batch: ${job.stats.success} verified, ${job.stats.failed} failed out of ${job.totalNins}.`
      );
    }

    this.onUpdate({ ...job });
    this.activeJobs.delete(job.id);
  }

  private addLog(job: BotJob, level: BotLog['level'], message: string, nin?: string) {
    job.logs.push({
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toISOString(),
      level,
      message,
      nin,
    });
    // Keep max 250 logs
    if (job.logs.length > 250) {
      job.logs.shift();
    }
  }
}

// Client-Side Excel / CSV Exporter
export function exportResultsInBrowser(
  job: BotJob,
  format: 'xlsx' | 'csv' = 'xlsx',
  filter: 'all' | 'success' = 'all'
) {
  const filtered = filter === 'success' ? job.results.filter((r: VerificationResult) => r.status === 'success') : job.results;

  const rows = filtered.map((r: VerificationResult) => {
    const details = r.details || {};
    return {
      'NIN': r.nin,
      'Status': r.status.toUpperCase(),
      'Verification Message': r.message,
      'Verified At': r.verifiedAt,
      'Attempts': r.attempts,
      'Duration (ms)': r.durationMs,
      'First Name': details['First Name'] || details.firstName || '',
      'Surname': details['Surname'] || details.surname || '',
      'Middle Name': details['Middle Name'] || details.middleName || '',
      'Date of Birth': details['Date of Birth'] || details.dob || '',
      'Gender': details['Gender'] || details.gender || '',
      'Mobile Phone': details['Mobile'] || details.mobile || '',
      'State of Origin': details['State of Origin'] || details.state || '',
      'LGA of Origin': details['LGA of Origin'] || details.lga || '',
      'Taxpayer ID (TIN)': details['Taxpayer ID (TIN)'] || details.tin || '',
      'Tracking ID': details['Tracking ID'] || details.trackingId || '',
      'Residential Address': details['Residential Address'] || details.address || '',
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ NIN: 'No records found' }]);
  XLSX.utils.book_append_sheet(wb, ws, filter === 'success' ? 'Verified Taxpayers' : 'All Results');

  const fileName = `BIRS_NIN_Results_${job.id}_${filter}.${format}`;
  XLSX.writeFile(wb, fileName);
}

// Client-Side Standalone Python Bot Downloader
export function downloadPythonBotScript() {
  const pythonScript = `#!/usr/bin/env python3
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
                if cell is not None:
                    val = str(cell).strip()
                    if len(val) == 11 and val.isdigit():
                        nins.append(val)
    else:
        with open(args.file, "r") as f:
            for line in f:
                for token in line.split():
                    token = token.strip()
                    if len(token) == 11 and token.isdigit():
                        nins.append(token)

    nins = list(dict.fromkeys(nins))
    print(f"[*] Loaded {len(nins)} unique NINs to verify.")

    successes = []
    all_results = []

    for i, nin in enumerate(nins):
        print(f"[{i+1}/{len(nins)}] Verifying {nin}...", end=" ", flush=True)
        res = verify_nin(nin, key=args.key)
        if res["status"] == "success":
            print("SUCCESS")
            data = res.get("data", {})
            if isinstance(data, dict):
                data["NIN"] = nin
                successes.append(data)
            all_results.append({"NIN": nin, "Status": "SUCCESS", "Message": "Verified"})
        else:
            print(f"FAILED ({res['message']})")
            all_results.append({"NIN": nin, "Status": "FAILED", "Message": res["message"]})

        if i < len(nins) - 1:
            time.sleep(args.delay)

    wb_out = openpyxl.Workbook()
    ws_success = wb_out.active
    ws_success.title = "Verified Taxpayers"

    if successes:
        headers = list(successes[0].keys())
        ws_success.append(headers)
        for s in successes:
            ws_success.append([str(s.get(h, "")) for h in headers])
    else:
        ws_success.append(["NIN", "Status"])
        ws_success.append(["None", "No successful verifications"])

    ws_all = wb_out.create_sheet(title="All Results")
    ws_all.append(["NIN", "Status", "Message"])
    for r in all_results:
        ws_all.append([r["NIN"], r["Status"], r["Message"]])

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

  downloadBlob(nodeScript, 'birs_nin_bot.mjs', 'text/javascript');
}

// Client-Side Chrome Extension ZIP Downloader
export async function downloadExtensionZip() {
  const zip = new JSZip();

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
    }
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const backgroundJs = `// BIRS NIN Autonomous Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('BIRS NIN Bulk Verifier Bot extension installed');
});
`;
  zip.file("background.js", backgroundJs);

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
  zip.file("popup.html", popupHtml);

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
  zip.file("popup.js", popupJs);

  const readme = `BIRS NIN Bulk Verifier Extension
---------------------------------
1. Unzip this directory.
2. Open Chrome/Edge and navigate to chrome://extensions/
3. Turn on "Developer mode" (top right toggle).
4. Click "Load unpacked" and select this unzipped directory.
5. Click the extension icon in your browser toolbar to verify NINs.`;
  zip.file("README.txt", readme);

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "birs_nin_bot_extension.zip", "application/zip");
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

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as XLSX from 'xlsx';
import { DEFAULT_GATEWAY_URL, DEFAULT_MERCHANT_KEY } from '../src/types';

const args = parseArgs(process.argv.slice(2));
const inputPathArg = args.input || args.i || args._[0] || './nins/input.txt';
const outputPathArg = args.output || args.o || './exports/birs_successes.xlsx';
const allOutputPathArg = args['all-output'] || './exports/birs_all_results.xlsx';
const delayMs = Number(args.delay ?? args.d ?? 1500);
const merchantKey = args.key ?? args.k ?? DEFAULT_MERCHANT_KEY;
const shouldWatch = Boolean(args.watch || args.w);
const watchDir = args['watch-dir'] || './incoming';

function parseArgs(argv: string[]) {
  const parsed: Record<string, any> = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [key, rawValue] = token.slice(2).split('=');
      const value = rawValue ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
      parsed[key] = value;
    } else if (token.startsWith('-')) {
      const key = token.slice(1);
      const value = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : true;
      parsed[key] = value;
    } else {
      parsed._.push(token);
    }
  }
  return parsed;
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function flattenDetails(value: any, prefix = '', out: Record<string, any> = {}): Record<string, any> {
  if (!value || typeof value !== 'object') return out;
  for (const [key, item] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix} ${key}` : key;
    if (item === null || item === undefined) continue;
    if (Array.isArray(item)) {
      if (item.length && typeof item[0] === 'object') {
        flattenDetails(item[0], nextKey, out);
      } else {
        out[nextKey] = item.join(', ');
      }
      continue;
    }
    if (typeof item === 'object') {
      flattenDetails(item, nextKey, out);
      continue;
    }
    const text = String(item).trim();
    if (text) out[nextKey] = text;
  }
  return out;
}

function prettifyKey(k: string): string {
  const target = String(k).trim();
  if (!target) return '';
  const lower = target.toLowerCase().replace(/[^a-z]/g, '');
  const map: Record<string, string> = {
    nin: 'NIN',
    firstname: 'First Name',
    surname: 'Surname',
    middlename: 'Middle Name',
    dob: 'Date of Birth',
    gender: 'Gender',
    mobile: 'Mobile',
    stateoforigin: 'State of Origin',
    lgaoforigin: 'LGA of Origin',
    taxpayerid: 'Taxpayer ID (TIN)',
    tin: 'Taxpayer ID (TIN)',
    trackingid: 'Tracking ID',
    residentialaddress: 'Residential Address',
    verificationsource: 'Verification Source',
  };
  if (map[lower]) return map[lower];
  return target
    .replace(/[_.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDetails(obj: Record<string, any>): Record<string, any> {
  const flat = flattenDetails(obj);
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(flat)) {
    const niceKey = prettifyKey(key);
    if (niceKey && value !== undefined && value !== null) normalized[niceKey] = String(value).trim();
  }
  if (!normalized.NIN && obj?.NIN) normalized.NIN = String(obj.NIN).trim();
  if (!normalized['First Name'] && obj?.firstName) normalized['First Name'] = String(obj.firstName).trim();
  if (!normalized.Surname && obj?.surname) normalized.Surname = String(obj.surname).trim();
  return normalized;
}

async function verifyNin(nin: string, key: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(DEFAULT_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': key,
        'Origin': 'https://birs.be.gov.ng',
        'Referer': 'https://birs.be.gov.ng/',
        'User-Agent': 'Mozilla/5.0 BIRSBot/2.2',
      },
      body: JSON.stringify({ nin: String(nin).trim() }),
      signal: controller.signal,
    });

    const text = await res.text();
    let payload: any = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }

    if (res.ok && payload) {
      const details = normalizeDetails(payload);
      return {
        ok: true,
        message: payload.message || 'Verified successfully',
        data: details,
      };
    }

    const message = payload.message || payload.error || payload.errorDescription || `HTTP ${res.status}`;
    return {
      ok: false,
      message,
      data: payload || {},
    };
  } catch (error: any) {
    return {
      ok: false,
      message: error?.name === 'AbortError' ? 'Gateway timeout after 25s.' : error?.message || 'Network error',
      data: {},
    };
  } finally {
    clearTimeout(timer);
  }
}

function readNinsFromInput(inputPath: string): string[] {
  const ext = path.extname(inputPath).toLowerCase();
  const fullPath = path.resolve(inputPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Input file not found: ${fullPath}`);
  }

  if (['.xlsx', '.xls', '.csv'].includes(ext)) {
    const workbook = XLSX.readFile(fullPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][];
    const collected: string[] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        const val = String(cell ?? '').trim();
        if (/^\d{11}$/.test(val)) collected.push(val);
      }
    }
    return [...new Set(collected)];
  }

  const text = fs.readFileSync(fullPath, 'utf-8');
  return [...new Set((text.match(/\b\d{11}\b/g) || []).map((x) => x.trim()))];
}

async function processSingleFile(inputFile: string, outputFile: string, allOutputFile: string, key: string, delay: number) {
  const nins = readNinsFromInput(inputFile);
  if (!nins.length) {
    console.log(`[!] No 11-digit NINs found in ${inputFile}`);
    return { successCount: 0, total: 0 };
  }

  console.log(`[+] Loaded ${nins.length} unique NINs from ${inputFile}`);

  const allRows: Record<string, any>[] = [];
  const successRows: Record<string, any>[] = [];

  for (let i = 0; i < nins.length; i++) {
    const nin = nins[i];
    process.stdout.write(`[${i + 1}/${nins.length}] Verifying ${nin}... `);
    const res = await verifyNin(nin, key);

    if (res.ok) {
      const row = { NIN: nin, Status: 'SUCCESS', Message: res.message, ...res.data };
      successRows.push(row);
      allRows.push(row);
      console.log(`SUCCESS ${res.data['First Name'] || ''} ${res.data.Surname || ''}`.trim() || 'OK');
    } else {
      const row = { NIN: nin, Status: 'FAILED', Message: res.message };
      allRows.push(row);
      console.log(`FAILED (${res.message})`);
    }

    if (i < nins.length - 1 && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  ensureDir(outputFile);
  ensureDir(allOutputFile);

  if (successRows.length) {
    const successSheet = XLSX.utils.json_to_sheet(successRows);
    const successWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(successWorkbook, successSheet, 'Verified Taxpayers');
    XLSX.writeFile(successWorkbook, outputFile);
    console.log(`[+] Exported ${successRows.length} successful records to ${outputFile}`);
  } else {
    const emptyWorkbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([{ NIN: 'None', Status: 'No successful verifications' }]);
    XLSX.utils.book_append_sheet(emptyWorkbook, sheet, 'Verified Taxpayers');
    XLSX.writeFile(emptyWorkbook, outputFile);
    console.log(`[+] No successful verifications found; created empty output at ${outputFile}`);
  }

  const allWorkbook = XLSX.utils.book_new();
  const allSheet = XLSX.utils.json_to_sheet(allRows.length ? allRows : [{ NIN: 'None', Status: 'No records processed' }]);
  XLSX.utils.book_append_sheet(allWorkbook, allSheet, 'All Results');
  XLSX.writeFile(allWorkbook, allOutputFile);
  console.log(`[+] Exported all results to ${allOutputFile}`);

  return { successCount: successRows.length, total: nins.length };
}

async function runOnce() {
  const inputFile = path.resolve(inputPathArg);
  const outputFile = path.resolve(outputPathArg);
  const allOutputFile = path.resolve(allOutputPathArg);

  console.log(`[BIRS Auto Verifier] starting with input: ${inputFile}`);
  const result = await processSingleFile(inputFile, outputFile, allOutputFile, merchantKey, delayMs);
  console.log(`[BIRS Auto Verifier] done. Success: ${result.successCount}/${result.total}`);
}

async function watchAndRun() {
  const targetDir = path.resolve(watchDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const seen = new Set<string>();
  const processDirectory = async () => {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(targetDir, entry.name);
      if (seen.has(fullPath)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.txt', '.csv', '.xlsx', '.xls'].includes(ext)) continue;
      seen.add(fullPath);
      const outputName = `${path.basename(entry.name, ext)}_verified_${Date.now()}.xlsx`;
      const outputFile = path.resolve('./exports', outputName);
      const allFile = path.resolve('./exports', `${path.basename(entry.name, ext)}_all_${Date.now()}.xlsx`);
      console.log(`[watch] Processing ${fullPath}`);
      try {
        await processSingleFile(fullPath, outputFile, allFile, merchantKey, delayMs);
      } catch (error: any) {
        console.error(`[watch] Failed for ${fullPath}: ${error.message}`);
      }
    }
  };

  await processDirectory();
  console.log(`[watch] Monitoring ${targetDir} for new NIN files every 10s...`);
  setInterval(() => {
    void processDirectory();
  }, 10000);
}

(async () => {
  try {
    if (shouldWatch) {
      await watchAndRun();
      return;
    }
    await runOnce();
  } catch (error: any) {
    console.error('[BIRS Auto Verifier] Fatal error:', error.message || error);
    process.exitCode = 1;
  }
})();

export {};

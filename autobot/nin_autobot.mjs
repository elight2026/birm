/**
 * BIRS Autonomous Bulk NIN Verification Bot (GitHub Actions & Server Runner)
 * 
 * Runs autonomously in Node.js (zero browser CORS restrictions).
 * - Opens and reads NINs from autobot/nins/input.txt or Excel files
 * - Queries service-gateway.bsg.com.ng directly
 * - Filters and exports ONLY successful verifications with their names & full details
 * - Saves results to autobot/results/birs_successful_taxpayers.xlsx
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as XLSX from 'xlsx';

const DEFAULT_GATEWAY_URL = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_MERCHANT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

const merchantKey = (process.env.MERCHANT_KEY || DEFAULT_MERCHANT_KEY).trim();
const gatewayUrl = (process.env.GATEWAY_URL || DEFAULT_GATEWAY_URL).trim();
const delayMs = Number(process.env.DELAY_MS || 1500);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function prettifyKey(k) {
  const target = String(k || '').trim();
  if (!target) return '';
  const lower = target.toLowerCase().replace(/[^a-z]/g, '');
  const map = {
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

function flattenDetails(value, prefix = '', out = {}) {
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

function normalizeDetails(obj) {
  const flat = flattenDetails(obj);
  const normalized = {};
  for (const [key, value] of Object.entries(flat)) {
    const niceKey = prettifyKey(key);
    if (niceKey && value !== undefined && value !== null) normalized[niceKey] = String(value).trim();
  }
  if (!normalized['NIN'] && obj?.nin) normalized['NIN'] = String(obj.nin).trim();
  if (!normalized['First Name'] && obj?.firstName) normalized['First Name'] = String(obj.firstName).trim();
  if (!normalized['Surname'] && obj?.surname) normalized['Surname'] = String(obj.surname).trim();
  return normalized;
}

async function verifyNin(nin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MERCHANT-KEY': merchantKey,
        'Origin': 'https://birs.be.gov.ng',
        'Referer': 'https://birs.be.gov.ng/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BIRSAutonomousBot/3.0',
      },
      body: JSON.stringify({ nin: String(nin).trim() }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await res.text();
    let payload = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
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
  } catch (error) {
    return {
      ok: false,
      message: error?.name === 'AbortError' ? 'Gateway timeout after 25s.' : error?.message || 'Network error',
      data: {},
    };
  } finally {
    clearTimeout(timer);
  }
}

function findInputFiles() {
  const candidates = [
    './nins/input.txt',
    './nins/input.xlsx',
    './nins/input.csv',
    './input.txt',
    './input.xlsx',
    './input.csv',
    '../nins.txt',
    '../nins.xlsx'
  ];

  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function loadNins(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.xlsx', '.xls', '.csv'].includes(ext)) {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
    const collected = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        const val = String(cell ?? '').trim().replace(/\D/g, '');
        if (val.length === 11) collected.push(val);
      }
    }
    return [...new Set(collected)];
  }

  const text = fs.readFileSync(filePath, 'utf-8');
  const matches = text.match(/\b\d{11}\b/g) || [];
  return [...new Set(matches.map(x => x.trim()))];
}

async function main() {
  console.log('=====================================================');
  console.log('🤖 BIRS AUTONOMOUS BULK NIN VERIFICATION ROBOT');
  console.log('=====================================================');
  console.log(`[+] Gateway: ${gatewayUrl}`);
  console.log(`[+] Delay between checks: ${delayMs}ms`);

  const resultsDir = path.resolve('./results');
  ensureDir(resultsDir);

  const inputFile = findInputFiles();
  if (!inputFile) {
    console.log('[!] No input NIN file found in autobot/nins/input.txt');
    console.log('[+] Creating sample template at autobot/nins/input.txt');
    const ninsDir = path.resolve('./nins');
    ensureDir(ninsDir);
    fs.writeFileSync(path.join(ninsDir, 'input.txt'), '# Paste your 11-digit NINs here, one per line:\n', 'utf-8');
    
    // Create placeholder empty results
    const emptyWb = XLSX.utils.book_new();
    const emptyWs = XLSX.utils.json_to_sheet([{ Status: 'No input NINs found. Add NINs to autobot/nins/input.txt' }]);
    XLSX.utils.book_append_sheet(emptyWb, emptyWs, 'Instructions');
    XLSX.writeFile(emptyWb, path.join(resultsDir, 'birs_successful_taxpayers.xlsx'));
    return;
  }

  console.log(`[+] Loading NINs from: ${inputFile}`);
  const nins = loadNins(inputFile);
  console.log(`[+] Found ${nins.length} unique NINs to verify.\n`);

  if (nins.length === 0) {
    console.log('[!] No valid 11-digit NINs found in file.');
    return;
  }

  const successfulRecords = [];
  const allRecords = [];

  for (let i = 0; i < nins.length; i++) {
    const nin = nins[i];
    process.stdout.write(`[${i + 1}/${nins.length}] Verifying ${nin}... `);

    const res = await verifyNin(nin);

    if (res.ok) {
      const fullName = [res.data['First Name'], res.data['Surname']].filter(Boolean).join(' ') || 'Validated Taxpayer';
      console.log(`✅ SUCCESS -> ${fullName} (${res.data['State of Origin'] || ''} - ${res.data['LGA of Origin'] || ''})`);
      
      const record = {
        'NIN': nin,
        'Verification Status': 'SUCCESS',
        'Full Name': fullName,
        ...res.data,
        'Verified At': new Date().toISOString()
      };
      successfulRecords.push(record);
      allRecords.push(record);
    } else {
      console.log(`❌ FAILED -> ${res.message}`);
      allRecords.push({
        'NIN': nin,
        'Verification Status': 'FAILED',
        'Error Reason': res.message,
        'Checked At': new Date().toISOString()
      });
    }

    if (i < nins.length - 1 && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  console.log('\n=====================================================');
  console.log(`🎉 Batch Verification Complete!`);
  console.log(`📊 Total Processed: ${nins.length}`);
  console.log(`✅ Successful Taxpayers: ${successfulRecords.length}`);
  console.log(`❌ Failed: ${nins.length - successfulRecords.length}`);
  console.log('=====================================================');

  // Export 1: ONLY Successful Verified Taxpayers with Names and Details
  const successPath = path.join(resultsDir, 'birs_successful_taxpayers.xlsx');
  const successCsvPath = path.join(resultsDir, 'birs_successful_taxpayers.csv');
  
  if (successfulRecords.length > 0) {
    const successWs = XLSX.utils.json_to_sheet(successfulRecords);
    const successWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(successWb, successWs, 'Verified Taxpayers');
    XLSX.writeFile(successWb, successPath);

    const csvContent = XLSX.utils.sheet_to_csv(successWs);
    fs.writeFileSync(successCsvPath, csvContent, 'utf-8');
    console.log(`[+] Saved ${successfulRecords.length} SUCCESSFUL records to:`);
    console.log(`    ├── ${successPath}`);
    console.log(`    └── ${successCsvPath}`);
  } else {
    console.log('[!] Zero successful verifications to export.');
    const emptyWb = XLSX.utils.book_new();
    const emptyWs = XLSX.utils.json_to_sheet([{ Note: 'No successful verifications found in this run' }]);
    XLSX.utils.book_append_sheet(emptyWb, emptyWs, 'Empty Results');
    XLSX.writeFile(emptyWb, successPath);
  }

  // Export 2: Complete Audit Trail
  const allPath = path.join(resultsDir, 'birs_all_results.xlsx');
  const allWs = XLSX.utils.json_to_sheet(allRecords);
  const allWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(allWb, allWs, 'All Results');
  XLSX.writeFile(allWb, allPath);
  console.log(`[+] Saved full audit log to: ${allPath}`);
}

main().catch(err => {
  console.error('[!] Fatal bot error:', err);
  process.exit(1);
});

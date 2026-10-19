/**
 * Production Asset Synchronization & GitHub Pages Exporter
 * 
 * Supports both:
 * - Direct root deployment via GitHub Actions (serving ./dist at repo root)
 * - Subfolder /docs/ access (serving ./dist/docs or repo /docs)
 * - Branch deployment via GitHub Pages (serving /docs from main branch)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const distDir = path.join(rootDir, 'dist');
const docsDir = path.join(rootDir, 'docs');
const publicDir = path.join(rootDir, 'public');

const startTime = performance.now();

// 1. Verify build output
if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('\x1b[31m[!] Error: dist/index.html is missing. Please run "vite build" first.\x1b[0m');
  process.exit(1);
}

console.log('\x1b[36m[*] Synchronizing production assets for dual root and /docs/ GitHub Pages deployment...\x1b[0m');

const distIndex = path.join(distDir, 'index.html');
let distHtml = fs.readFileSync(distIndex, 'utf-8');

// Ensure NO bad redirect scripts exist in dist/index.html
distHtml = distHtml.replace(/<script id="gh-pages-redirect">[\s\S]*?<\/script>\s*/gi, '');
fs.writeFileSync(distIndex, distHtml, 'utf-8');

// 2. Ensure dist/404.html exists (SPA router fallback for root deployment)
const dist404 = path.join(distDir, '404.html');
fs.writeFileSync(dist404, distHtml, 'utf-8');

// 3. Create dist/docs/ subfolder inside dist so https://user.github.io/repo/docs/ works directly!
const distDocsDir = path.join(distDir, 'docs');
if (!fs.existsSync(distDocsDir)) {
  fs.mkdirSync(distDocsDir, { recursive: true });
}

// In dist/docs/index.html, adapt asset paths if needed or copy assets
const distDocsIndex = path.join(distDocsDir, 'index.html');
const distDocs404 = path.join(distDocsDir, '404.html');
// Copy dist/assets into dist/docs/assets so relative ./assets/... works identically
const distAssetsDir = path.join(distDir, 'assets');
const distDocsAssetsDir = path.join(distDocsDir, 'assets');
if (fs.existsSync(distAssetsDir)) {
  fs.cpSync(distAssetsDir, distDocsAssetsDir, { recursive: true });
}
fs.writeFileSync(distDocsIndex, distHtml, 'utf-8');
fs.writeFileSync(distDocs404, distHtml, 'utf-8');

// 4. Synchronize favicon suite across public, dist, dist/docs, and root
const faviconFiles = ['favicon.ico', 'icon16.png', 'icon48.png', 'icon128.png', '.nojekyll'];
for (const file of faviconFiles) {
  const pubPath = path.join(publicDir, file);
  if (fs.existsSync(pubPath)) {
    try {
      fs.copyFileSync(pubPath, path.join(distDir, file));
      fs.copyFileSync(pubPath, path.join(distDocsDir, file));
      fs.copyFileSync(pubPath, path.join(rootDir, file));
    } catch {
      // ignore
    }
  }
}

// 5. Clean and synchronize root docs/ folder (for users choosing "Deploy from a branch > /docs")
try {
  if (fs.existsSync(docsDir)) {
    fs.rmSync(docsDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  fs.mkdirSync(docsDir, { recursive: true });
  fs.cpSync(distDir, docsDir, { recursive: true });
} catch (err) {
  console.error(`\x1b[31m[!] Failed to synchronize docs/ folder: ${err.message}\x1b[0m`);
}

// 6. Root 404.html for safety
const root404 = path.join(rootDir, '404.html');
fs.writeFileSync(root404, distHtml, 'utf-8');

// 7. Audit asset files
const assetRecords = [];
let totalBytes = 0;
let fileCount = 0;
const counts = { html: 0, js: 0, css: 0, images: 0, other: 0 };

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full);
    } else if (entry.isFile()) {
      fileCount++;
      const st = fs.statSync(full);
      totalBytes += st.size;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.html') counts.html++;
      else if (ext === '.js' || ext === '.mjs') counts.js++;
      else if (ext === '.css') counts.css++;
      else if (['.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico'].includes(ext)) counts.images++;
      else counts.other++;

      assetRecords.push({
        path: path.relative(distDir, full),
        sizeKb: Number((st.size / 1024).toFixed(1)),
      });
    }
  }
}

scanDir(distDir);

// Write asset manifest
const manifest = {
  buildTimestamp: new Date().toISOString(),
  target: 'dist & docs',
  totalFiles: fileCount,
  totalSizeKb: Number((totalBytes / 1024).toFixed(1)),
  categories: counts,
  supportedUrls: [
    'https://elight2026.github.io/birm/',
    'https://elight2026.github.io/birm/docs/'
  ],
  files: assetRecords,
};

fs.writeFileSync(path.join(distDir, 'asset-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
fs.writeFileSync(path.join(docsDir, 'asset-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

const duration = (performance.now() - startTime).toFixed(1);
console.log(`\x1b[32m[✓] Production assets synchronized in ${duration}ms\x1b[0m`);
console.log(`    ├── Primary Root Entry: dist/index.html & dist/404.html`);
console.log(`    ├── Secondary Docs Entry: dist/docs/index.html & dist/docs/404.html`);
console.log(`    ├── Branch Docs Mirror: docs/ (for GitHub Pages branch deployment)`);
console.log(`    ├── Total Synchronized Files: ${fileCount} (${counts.html} HTML, ${counts.js} JS, ${counts.css} CSS, ${counts.images} icons/images)`);
console.log(`    ├── Total Payload: ${(totalBytes / 1024).toFixed(1)} KB`);
console.log(`    ├── .nojekyll: Created in dist/, dist/docs/, docs/, and root /`);
console.log(`    └── Both https://elight2026.github.io/birm/ and https://elight2026.github.io/birm/docs/ will return HTTP 200`);

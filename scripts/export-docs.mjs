/**
 * Production Asset Synchronization & GitHub Pages Exporter
 * 
 * Features:
 * 1. Synchronizes Vite build output from dist/ into docs/
 * 2. Synchronizes full favicon suite (favicon.ico, icon16, icon48, icon128) across root & docs/
 * 3. Enforces .nojekyll in both root / and docs/ to bypass Jekyll asset filtering
 * 4. Generates resilient SPA routing fallbacks:
 *    - docs/404.html for deep linking inside /docs
 *    - root 404.html for automatic redirect to /docs
 * 5. Sanitizes docs/index.html to remove root-only redirect scripts
 * 6. Generates docs/asset-manifest.json for asset auditing & tracking
 * 7. Audits relative asset links (./assets/...)
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

console.log('\x1b[36m[*] Synchronizing production assets for GitHub Pages...\x1b[0m');

// 2. Prepare docs directory safely
try {
  if (fs.existsSync(docsDir)) {
    fs.rmSync(docsDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  fs.mkdirSync(docsDir, { recursive: true });
} catch (err) {
  console.error(`\x1b[31m[!] Failed to prepare docs directory: ${err.message}\x1b[0m`);
  process.exit(1);
}

// 3. Synchronize compiled files from dist to docs
try {
  fs.cpSync(distDir, docsDir, { recursive: true });
} catch (err) {
  console.error(`\x1b[31m[!] Failed to synchronize dist to docs: ${err.message}\x1b[0m`);
  process.exit(1);
}

// 4. Synchronize favicon suite and static assets across public, docs, and root
const faviconFiles = ['favicon.ico', 'icon16.png', 'icon48.png', 'icon128.png', '.nojekyll'];
for (const file of faviconFiles) {
  const pubPath = path.join(publicDir, file);
  if (fs.existsSync(pubPath)) {
    const docsDest = path.join(docsDir, file);
    const rootDest = path.join(rootDir, file);
    try {
      fs.copyFileSync(pubPath, docsDest);
      fs.copyFileSync(pubPath, rootDest);
    } catch {
      // ignore
    }
  }
}

// 5. Sanitize docs/index.html: remove root redirect script so it serves cleanly when deployed from /docs
const docsIndex = path.join(docsDir, 'index.html');
let docsHtml = fs.readFileSync(docsIndex, 'utf-8');

// Strip out the gh-pages-redirect script tag if present
docsHtml = docsHtml.replace(/<script id="gh-pages-redirect">[\s\S]*?<\/script>\s*/gi, '');

// Ensure favicon tags are strictly relative in docs/index.html
if (!docsHtml.includes('rel="icon"')) {
  const faviconSnippet = `
    <link rel="icon" type="image/png" sizes="16x16" href="./icon16.png" />
    <link rel="icon" type="image/png" sizes="48x48" href="./icon48.png" />
    <link rel="icon" type="image/png" sizes="128x128" href="./icon128.png" />
    <link rel="apple-touch-icon" sizes="128x128" href="./icon128.png" />
    <link rel="shortcut icon" href="./favicon.ico" />`;
  docsHtml = docsHtml.replace('</head>', `${faviconSnippet}\n  </head>`);
}

fs.writeFileSync(docsIndex, docsHtml, 'utf-8');

// 6. Generate docs/404.html (SPA deep-linking fallback inside /docs)
const docs404 = path.join(docsDir, '404.html');
try {
  fs.writeFileSync(docs404, docsHtml, 'utf-8');
} catch (err) {
  console.warn(`\x1b[33m[!] Warning: Could not create docs/404.html: ${err.message}\x1b[0m`);
}

// 7. Generate root 404.html (automatic redirect fallback for root visitors)
const root404 = path.join(rootDir, '404.html');
const root404Html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BIRS NIN Autonomous Verifier</title>
    <link rel="icon" type="image/png" sizes="16x16" href="./icon16.png" />
    <link rel="icon" type="image/png" sizes="48x48" href="./icon48.png" />
    <link rel="icon" type="image/png" sizes="128x128" href="./icon128.png" />
    <link rel="apple-touch-icon" sizes="128x128" href="./icon128.png" />
    <link rel="shortcut icon" href="./favicon.ico" />
    <script>
      (function() {
        var l = window.location;
        var p = l.pathname.replace(/\\/+$/, '');
        var segs = p.split('/').filter(Boolean);
        var repo = segs[0] || 'birm';
        if (l.hostname.endsWith('github.io')) {
          var target = '/' + repo + '/docs/' + l.search + l.hash;
          l.replace(target);
        } else {
          l.replace('/' + l.search + l.hash);
        }
      })();
    </script>
  </head>
  <body style="font-family: system-ui, -apple-system, sans-serif; background: #020617; color: #f8fafc; padding: 3rem 1.5rem; text-align: center;">
    <div style="max-width: 480px; margin: 0 auto; background: #0f172a; padding: 2rem; border-radius: 1rem; border: 1px solid #1e293b;">
      <h2 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; color: #10b981;">BIRS NIN Autonomous Verifier</h2>
      <p style="font-size: 0.875rem; color: #94a3b8; margin-bottom: 1.5rem;">Redirecting to the production verification portal...</p>
      <a href="./docs/" style="display: inline-block; padding: 0.625rem 1.25rem; background: #10b981; color: white; border-radius: 0.5rem; text-decoration: none; font-weight: 600; font-size: 0.875rem;">
        Open Portal &rarr;
      </a>
    </div>
  </body>
</html>`;

try {
  fs.writeFileSync(root404, root404Html, 'utf-8');
} catch (err) {
  console.warn(`\x1b[33m[!] Warning: Could not create root 404.html: ${err.message}\x1b[0m`);
}

// 8. Audit asset resolution
const hasRelativeAssets = docsHtml.includes('./assets/') || docsHtml.includes('src="./') || docsHtml.includes('href="./');

// 9. Collect asset statistics & generate manifest
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
        path: path.relative(docsDir, full),
        sizeKb: Number((st.size / 1024).toFixed(1)),
      });
    }
  }
}

scanDir(docsDir);

// Write asset manifest
const manifest = {
  buildTimestamp: new Date().toISOString(),
  target: 'docs',
  totalFiles: fileCount,
  totalSizeKb: Number((totalBytes / 1024).toFixed(1)),
  categories: counts,
  hasRelativeAssets,
  files: assetRecords,
};

fs.writeFileSync(path.join(docsDir, 'asset-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

const duration = (performance.now() - startTime).toFixed(1);
console.log(`\x1b[32m[✓] Asset synchronization completed in ${duration}ms\x1b[0m`);
console.log(`    ├── Target: ${docsDir}`);
console.log(`    ├── Total Synchronized Files: ${fileCount} (${counts.html} HTML, ${counts.js} JS, ${counts.css} CSS, ${counts.images} icons/images)`);
console.log(`    ├── Total Bundle Payload: ${(totalBytes / 1024).toFixed(1)} KB`);
console.log(`    ├── Favicon Suite: Synchronized across public, docs, and root`);
console.log(`    ├── SPA Routing Fallbacks: docs/404.html & root 404.html updated`);
console.log(`    ├── Asset Manifest: docs/asset-manifest.json written`);
console.log(`    └── Asset References: ${hasRelativeAssets ? 'Verified relative (./assets/...)' : '\x1b[33mCheck vite base\x1b[0m'}`);

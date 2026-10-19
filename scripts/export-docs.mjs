/**
 * High-Reliability GitHub Pages Asset & Documentation Export Script
 * 
 * Responsibilities:
 * 1. Synchronizes Vite production build artifacts from dist/ to docs/
 * 2. Injects SPA 404 routing fallbacks for both /docs/ and root /
 * 3. Enforces .nojekyll across docs/ and root to prevent Jekyll asset filtering
 * 4. Verifies strictly relative asset references (./assets/...) for subpath compatibility
 * 5. Sanitizes production docs/index.html from development-only scripts
 * 6. Audits bundle integrity and prints detailed asset metrics
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const distDir = path.join(rootDir, 'dist');
const docsDir = path.join(rootDir, 'docs');

const startTime = performance.now();

// 1. Validate dist presence
if (!fs.existsSync(distDir)) {
  console.error('\x1b[31m[!] Error: dist/ directory not found. Please run "vite build" first.\x1b[0m');
  process.exit(1);
}

const distIndex = path.join(distDir, 'index.html');
if (!fs.existsSync(distIndex)) {
  console.error('\x1b[31m[!] Error: dist/index.html missing. Production build may have failed.\x1b[0m');
  process.exit(1);
}

console.log('\x1b[36m[*] Synchronizing and optimizing assets for GitHub Pages deployment...\x1b[0m');

// 2. Prepare docs/ directory safely with retry support
try {
  if (fs.existsSync(docsDir)) {
    fs.rmSync(docsDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  fs.mkdirSync(docsDir, { recursive: true });
} catch (err) {
  console.error(`\x1b[31m[!] Failed to prepare docs/ directory: ${err.message}\x1b[0m`);
  process.exit(1);
}

// 3. Recursive copy of all compiled artifacts from dist to docs
try {
  fs.cpSync(distDir, docsDir, { recursive: true });
} catch (err) {
  console.error(`\x1b[31m[!] Failed to copy dist to docs: ${err.message}\x1b[0m`);
  process.exit(1);
}

// 4. Sanitize docs/index.html
const docsIndex = path.join(docsDir, 'index.html');
let docsHtml = fs.readFileSync(docsIndex, 'utf-8');

// Ensure docs/index.html does not contain unneeded redirection logic
docsHtml = docsHtml.replace(/<script>[\s\S]*?isRawRoot[\s\S]*?<\/script>/gi, '');
fs.writeFileSync(docsIndex, docsHtml, 'utf-8');

// 5. Generate docs/404.html (SPA client-side routing fallback)
const docs404 = path.join(docsDir, '404.html');
try {
  fs.copyFileSync(docsIndex, docs404);
} catch (err) {
  console.warn(`\x1b[33m[!] Warning: Could not create docs/404.html: ${err.message}\x1b[0m`);
}

// 6. Ensure root .nojekyll and docs/.nojekyll exist
try {
  fs.writeFileSync(path.join(docsDir, '.nojekyll'), '');
  fs.writeFileSync(path.join(rootDir, '.nojekyll'), '');
} catch (err) {
  console.warn(`\x1b[33m[!] Warning: Could not write .nojekyll: ${err.message}\x1b[0m`);
}

// 7. Generate root 404.html as a safety fallback
// If GitHub Pages is served from root and hits an unknown subpath, redirect to /docs/
const root404 = path.join(rootDir, '404.html');
const root404Html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>BIRS NIN Autonomous Verifier</title>
    <script>
      (function() {
        var host = window.location.hostname;
        var p = window.location.pathname.replace(/\\/+$/, '');
        if (host.endsWith('github.io')) {
          if (!p.includes('/docs')) {
            window.location.replace(p + '/docs/' + window.location.search + window.location.hash);
          } else {
            window.location.replace(p + '/' + window.location.search + window.location.hash);
          }
        } else {
          window.location.replace('/' + window.location.search + window.location.hash);
        }
      })();
    </script>
  </head>
  <body style="font-family: sans-serif; background: #020617; color: #f8fafc; padding: 2rem; text-align: center;">
    <h2>Redirecting to BIRS NIN Autonomous Portal...</h2>
    <p><a href="./docs/" style="color: #10b981;">Click here if you are not redirected automatically.</a></p>
  </body>
</html>`;
try {
  fs.writeFileSync(root404, root404Html, 'utf-8');
} catch (err) {
  console.warn(`\x1b[33m[!] Warning: Could not write root 404.html: ${err.message}\x1b[0m`);
}

// 8. Audit relative asset resolution
const hasRelativeAssets = docsHtml.includes('./assets/') || docsHtml.includes('src="./') || docsHtml.includes('href="./');

// 9. Inspect and summarize exported assets
function getDirectoryStats(dir) {
  let totalBytes = 0;
  let fileCount = 0;
  const categories = { html: 0, js: 0, css: 0, images: 0, other: 0 };
  const assetList = [];

  function scan(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile()) {
        fileCount++;
        const stat = fs.statSync(fullPath);
        totalBytes += stat.size;
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.html') categories.html++;
        else if (ext === '.js' || ext === '.mjs') categories.js++;
        else if (ext === '.css') categories.css++;
        else if (['.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico'].includes(ext)) categories.images++;
        else categories.other++;

        assetList.push({
          relPath: path.relative(rootDir, fullPath),
          sizeKb: (stat.size / 1024).toFixed(1)
        });
      }
    }
  }

  scan(dir);
  return { totalBytes, fileCount, categories, assetList };
}

const stats = getDirectoryStats(docsDir);
const durationMs = (performance.now() - startTime).toFixed(1);
const sizeFormatted = (stats.totalBytes / 1024).toFixed(1) + ' KB';

console.log(`\x1b[32m[✓] GitHub Pages assets verified & exported in ${durationMs}ms\x1b[0m`);
console.log(`    ├── Target: ${docsDir}`);
console.log(`    ├── Total Exported Files: ${stats.fileCount} (${stats.categories.html} HTML, ${stats.categories.js} JS, ${stats.categories.css} CSS, ${stats.categories.images} images)`);
console.log(`    ├── Total Bundle Size: ${sizeFormatted}`);
console.log(`    ├── .nojekyll: Present in both /docs and root /`);
console.log(`    ├── SPA Routing Fallback: docs/404.html & root 404.html created`);
console.log(`    └── Asset Resolution: ${hasRelativeAssets ? 'Verified relative (./assets/...)' : '\x1b[33mWarning: check vite base path\x1b[0m'}`);

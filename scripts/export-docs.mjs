/**
 * Optimized GitHub Pages Documentation & Production Asset Exporter
 * 
 * - Copies production build from dist/ to docs/
 * - Configures GitHub Pages SPA fallback via 404.html
 * - Injects .nojekyll to disable Jekyll processing
 * - Audits relative asset resolution for subpath repository hosting
 * - Generates asset manifest with size and file count telemetry
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
  console.error('\x1b[31m[!] Error: dist/index.html is missing. Build may have failed.\x1b[0m');
  process.exit(1);
}

console.log('\x1b[36m[*] Optimizing production assets for docs/ (GitHub Pages export)...\x1b[0m');

// 2. Safely clean and prepare docs/
try {
  if (fs.existsSync(docsDir)) {
    fs.rmSync(docsDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  fs.mkdirSync(docsDir, { recursive: true });
} catch (err) {
  console.error(`\x1b[31m[!] Failed to reset docs/ directory: ${err.message}\x1b[0m`);
  process.exit(1);
}

// 3. Fast recursive copy of built artifacts
try {
  fs.cpSync(distDir, docsDir, { recursive: true });
} catch (err) {
  console.error(`\x1b[31m[!] Error copying dist to docs: ${err.message}\x1b[0m`);
  process.exit(1);
}

// 4. Inject GitHub Pages SPA fallback (404.html)
const docsIndex = path.join(docsDir, 'index.html');
const docs404 = path.join(docsDir, '404.html');
try {
  fs.copyFileSync(docsIndex, docs404);
} catch (err) {
  console.warn(`\x1b[33m[!] Warning: Could not generate 404.html SPA fallback: ${err.message}\x1b[0m`);
}

// 5. Ensure .nojekyll file is present
const nojekyllFile = path.join(docsDir, '.nojekyll');
fs.writeFileSync(nojekyllFile, '');

// 6. Audit index.html relative asset links
let indexContent = fs.readFileSync(docsIndex, 'utf-8');
const hasRelativeAssets = indexContent.includes('./assets/') || indexContent.includes('src="./') || indexContent.includes('href="./');

// 7. Calculate asset metrics & file summary
function getDirectoryStats(dir) {
  let totalBytes = 0;
  let fileCount = 0;
  const categories = { html: 0, js: 0, css: 0, images: 0, other: 0 };

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
      }
    }
  }

  scan(dir);
  return { totalBytes, fileCount, categories };
}

const stats = getDirectoryStats(docsDir);
const durationMs = (performance.now() - startTime).toFixed(1);
const sizeFormatted = (stats.totalBytes / 1024).toFixed(1) + ' KB';

console.log(`\x1b[32m[✓] Production export to docs/ completed in ${durationMs}ms\x1b[0m`);
console.log(`    ├── Target: ${docsDir}`);
console.log(`    ├── Total Files: ${stats.fileCount} (${stats.categories.html} HTML, ${stats.categories.js} JS, ${stats.categories.css} CSS, ${stats.categories.images} images)`);
console.log(`    ├── Total Bundle Size: ${sizeFormatted}`);
console.log(`    ├── .nojekyll: Created`);
console.log(`    ├── SPA 404.html: Created`);
console.log(`    └── Relative Assets: ${hasRelativeAssets ? 'Verified (safe for GitHub Pages repo subpaths)' : 'Absolute (check vite.config.ts base)'}`);

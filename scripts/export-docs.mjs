import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const distDir = path.join(rootDir, 'dist');
const docsDir = path.join(rootDir, 'docs');

if (!fs.existsSync(distDir)) {
  console.error('[!] Error: dist/ directory not found. Run vite build first.');
  process.exit(1);
}

// Clean and recreate docs/
if (fs.existsSync(docsDir)) {
  fs.rmSync(docsDir, { recursive: true, force: true });
}
fs.mkdirSync(docsDir, { recursive: true });

// Copy all assets from dist to docs
fs.cpSync(distDir, docsDir, { recursive: true });

// Ensure .nojekyll is present so GitHub Pages does not ignore underscore files
fs.writeFileSync(path.join(docsDir, '.nojekyll'), '');

console.log('[✓] Successfully exported all production assets to docs/ for GitHub Pages deployment.');

import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { botService, verifySingleNin } from './src/services/botService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS & iFrame Friendly Headers for Browser Clients (GitHub Pages, localhost, Render)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MERCHANT-KEY, Authorization, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  next();
});

// Explicit OPTIONS preflight handler for browser CORS
app.options('*', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MERCHANT-KEY, Authorization, Accept');
  res.status(200).end();
});

// ---------------------- API ROUTES ---------------------- //

// Health Check & Proxy Diagnostics
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'BIRS NIN Server-Side Proxy is online and active',
    service: 'birs-server-proxy',
    time: new Date().toISOString(),
    cors: 'enabled (wildcard *)',
  });
});

// 1. Instant Single NIN Verification (Server-Side Proxy Endpoint)
app.post('/api/verify', async (req: Request, res: Response) => {
  const { nin, merchantKey, gatewayUrl, timeoutMs, isDemo } = req.body || {};
  if (!nin) {
    res.status(400).json({ error: 'NIN is required' });
    return;
  }
  const result = await verifySingleNin(String(nin), {
    merchantKey,
    gatewayUrl,
    timeoutMs,
    isDemo: Boolean(isDemo),
  });
  res.json(result);
});

// Universal Proxy Aliases (/api/proxy, /api/validate, /api/nin/validate)
app.post(['/api/proxy', '/api/validate', '/api/nin/validate'], async (req: Request, res: Response) => {
  const { nin, merchantKey, gatewayUrl, timeoutMs, isDemo } = req.body || {};
  if (!nin) {
    res.status(400).json({ error: 'NIN is required' });
    return;
  }
  const result = await verifySingleNin(String(nin), {
    merchantKey,
    gatewayUrl,
    timeoutMs,
    isDemo: Boolean(isDemo),
  });
  res.json(result);
});

// 2. Start Autonomous Bot Job
app.post('/api/bot/jobs', (req: Request, res: Response) => {
  const result = botService.createJob(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json(result);
});

// 3. List all jobs
app.get('/api/bot/jobs', (_req: Request, res: Response) => {
  res.json({ jobs: botService.listJobs() });
});

// 4. Get specific job details
app.get('/api/bot/jobs/:id', (req: Request, res: Response) => {
  const job = botService.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({ job });
});

// 5. Control job: Pause
app.post('/api/bot/jobs/:id/pause', (req: Request, res: Response) => {
  const result = botService.pauseJob(req.params.id);
  if (!result.ok) {
    res.status(404).json({ error: result.error });
    return;
  }
  res.json(result);
});

// 6. Control job: Resume
app.post('/api/bot/jobs/:id/resume', (req: Request, res: Response) => {
  const result = botService.resumeJob(req.params.id);
  if (!result.ok) {
    res.status(404).json({ error: result.error });
    return;
  }
  res.json(result);
});

// 7. Control job: Stop
app.post('/api/bot/jobs/:id/stop', (req: Request, res: Response) => {
  const result = botService.stopJob(req.params.id);
  if (!result.ok) {
    res.status(404).json({ error: result.error });
    return;
  }
  res.json(result);
});

// 8. Retry failed NINs
app.post('/api/bot/jobs/:id/retry-failed', (req: Request, res: Response) => {
  const result = botService.retryFailed(req.params.id);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

// 9. Real-time SSE Stream
app.get('/api/bot/jobs/:id/stream', (req: Request, res: Response) => {
  botService.subscribeStream(req.params.id, req, res);
});

// 10. Export results to Excel (.xlsx) / CSV / JSON
app.get('/api/bot/jobs/:id/export', (req: Request, res: Response) => {
  const format = String(req.query.format || 'xlsx').toLowerCase();
  const filter = String(req.query.filter || 'all').toLowerCase();
  const exported = botService.exportResults(req.params.id, format, filter);
  if (!exported) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.setHeader('Content-Type', exported.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
  res.send(exported.buffer);
});

// 11. Download Packaged Autonomous Chrome Extension (.zip)
app.get('/api/extension/download', async (_req: Request, res: Response) => {
  try {
    const buffer = await botService.generateExtensionZip();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="BIRS_NIN_Extension_v2.1.zip"');
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate extension zip: ' + err.message });
  }
});

// 12. Standalone Python Bot Script Generator
app.get('/api/standalone/python', (_req: Request, res: Response) => {
  const pythonScript = botService.getPythonScript();
  res.setHeader('Content-Type', 'text/x-python');
  res.setHeader('Content-Disposition', 'attachment; filename="birs_nin_bot.py"');
  res.send(pythonScript);
});

// 13. Standalone Node.js Bot Script Generator
app.get('/api/standalone/node', (_req: Request, res: Response) => {
  const nodeScript = botService.getNodeScript();
  res.setHeader('Content-Type', 'text/javascript');
  res.setHeader('Content-Disposition', 'attachment; filename="birs_nin_bot.mjs"');
  res.send(nodeScript);
});

// Vite Integration
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.join(__dirname, 'dist');
  const hasDist = fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'));

  if (isProd && hasDist) {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.get('*', async (req: Request, res: Response, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        const reactRefreshPreamble = `
    <script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>`;
        if (!template.includes('__vite_plugin_react_preamble_installed__')) {
          template = template.replace('<head>', `<head>${reactRefreshPreamble}`);
        }
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        next(e);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[BIRS NIN Autonomous Bot] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});

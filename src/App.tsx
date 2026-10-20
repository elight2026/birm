/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Bot,
  Play,
  Pause,
  Square,
  RotateCcw,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  RefreshCw,
  FileSpreadsheet,
  Terminal,
  Settings,
  Copy,
  Check,
  Eye,
  ShieldCheck,
  Zap,
  Clock,
  Layers,
  FileText,
  Code2,
  ExternalLink,
  ChevronDown,
  Sparkles,
  Globe,
  Cpu,
  Server,
  HelpCircle,
  X,
  CheckCircle,
  Info,
  SlidersHorizontal,
  History,
  ListFilter,
  UploadCloud,
  Cloud,
  FileDown,
  Fingerprint,
  Building2,
  Phone,
  Calendar,
  MapPin,
  Hash,
  Table as TableIcon,
  MessageSquare,
  FileCode,
  ShieldAlert,
  UserCheck,
  KeyRound,
  Activity,
  Gauge,
  Timer,
  Filter,
  Database,
  Radio,
  Puzzle,
  TrendingUp,
  BadgeCheck
} from 'lucide-react';
import type {
  VerificationResult,
  BotLog,
  BotJob,
  BotJobSettings,
  BotJobStats,
  TaxpayerDetails,
  SingleLookupResult,
  EngineMode,
  ActiveTab,
  ResultFilter,
  LogFilter,
  ExportFormat,
  ExportFilter,
  ToastNotification
} from './types';
import {
  ClientBotManager,
  exportResultsInBrowser,
  downloadPythonBotScript,
  downloadNodeBotScript,
  downloadExtensionZip,
  verifyNinInBrowser,
  DEFAULT_GATEWAY_URL,
  DEFAULT_MERCHANT_KEY,
  BIRS_DIRECT_PORTAL_URL,
  testProxyConnection,
  downloadNodeProxyScript,
  downloadPythonProxyScript,
  downloadGoProxyScript
} from './services/clientBotEngine';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('bot');
  
  // Toast Notification State
  const [toast, setToast] = useState<ToastNotification | null>(null);
  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  };

  // Execution Engine & Server Detection State
  const [engineMode, setEngineMode] = useState<EngineMode>('server');
  const [isServerAvailable, setIsServerAvailable] = useState<boolean | null>(null);
  const [showDeployGuide, setShowDeployGuide] = useState(false);
  const [showProxyHub, setShowProxyHub] = useState(false);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    message: string;
    endpointTested?: string;
  } | null>(null);
  const [proxyTab, setProxyTab] = useState<'connect' | 'render' | 'vercel' | 'python' | 'go' | 'node' | 'aws'>('connect');

  // Bot Batch State
  const [currentJob, setCurrentJob] = useState<BotJob | null>(null);
  const currentJobRef = useRef<BotJob | null>(null);
  currentJobRef.current = currentJob;

  const [jobList, setJobList] = useState<any[]>([]);
  const [inputNinsText, setInputNinsText] = useState('');
  const [parsedNins, setParsedNins] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Engine Mode: Live Gateway (Real Verification - Default) vs Optional Simulated Sandbox
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [proxyUrl, setProxyUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('birs_proxy_url') || '';
    }
    return '';
  });
  const [gatewayUrl, setGatewayUrl] = useState<string>(DEFAULT_GATEWAY_URL);
  const [isExtensionConnected, setIsExtensionConnected] = useState(false);

  // Bot Settings Controls
  const [delayMs, setDelayMs] = useState(2000);
  const [jitterMs, setJitterMs] = useState(300);
  const [concurrency, setConcurrency] = useState(1);
  const [autoRetry, setAutoRetry] = useState(true);
  const [maxRetries, setMaxRetries] = useState(2);
  const [merchantKey, setMerchantKey] = useState(DEFAULT_MERCHANT_KEY);

  // Result inspection
  const [selectedResult, setSelectedResult] = useState<VerificationResult | null>(null);
  const [resultFilter, setResultFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [logFilter, setLogFilter] = useState<'all' | 'error'>('all');
  const [copiedKey, setCopiedKey] = useState(false);

  // Client-Side Bot Manager (for standalone / GitHub Pages execution)
  const clientBotManagerRef = useRef<ClientBotManager | null>(null);
  if (!clientBotManagerRef.current) {
    clientBotManagerRef.current = new ClientBotManager((updatedJob) => {
      setCurrentJob({ ...updatedJob });
      saveLocalJob(updatedJob);
    });
  }

  // Local Storage persistence for static hosts (GitHub Pages)
  const saveLocalJob = (job: BotJob) => {
    try {
      const stored = localStorage.getItem('birs_local_jobs');
      let list: BotJob[] = stored ? JSON.parse(stored) : [];
      const idx = list.findIndex((j) => j.id === job.id);
      if (idx >= 0) {
        list[idx] = job;
      } else {
        list.unshift(job);
      }
      localStorage.setItem('birs_local_jobs', JSON.stringify(list.slice(0, 30)));
      setJobList(list);
    } catch {
      // ignore
    }
  };

  const loadLocalJobs = () => {
    try {
      const stored = localStorage.getItem('birs_local_jobs');
      if (stored) {
        const parsed: BotJob[] = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setJobList(parsed);
          if (!currentJobRef.current) {
            setCurrentJob(parsed[0]);
          }
        }
      }
    } catch {
      // ignore
    }
  };

  // Single NIN Testbench State
  const [singleNin, setSingleNin] = useState('');
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleResult, setSingleResult] = useState<any | null>(null);

  // Terminal scroll ref
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Initial and periodic fetch of jobs
  useEffect(() => {
    fetchJobs();
    const interval = setInterval(() => {
      fetchJobs();
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  // Detect Chrome Extension Bridge
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).__BIRS_EXTENSION_AVAILABLE__) {
      setIsExtensionConnected(true);
    }
    const onExtMsg = (e: MessageEvent) => {
      if (e.data?.type === 'BIRS_EXTENSION_READY') {
        setIsExtensionConnected(true);
      }
    };
    window.addEventListener('message', onExtMsg);
    return () => window.removeEventListener('message', onExtMsg);
  }, []);

  // Real-time SSE connection with polling fallback (active only when server is available)
  useEffect(() => {
    if (!currentJob?.id || engineMode !== 'server' || !isServerAvailable) return;

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`/api/bot/jobs/${currentJob.id}/stream`);

      eventSource.addEventListener('log', (e) => {
        try {
          const log: BotLog = JSON.parse(e.data);
          setCurrentJob((prev) => {
            if (!prev || prev.id !== currentJob.id) return prev;
            const logs = prev.logs || [];
            const exists = logs.some((l) => l.id === log.id);
            if (exists) return prev;
            return { ...prev, logs: [...logs, log] };
          });
        } catch {
          // ignore malformed SSE log
        }
      });

      eventSource.addEventListener('result', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!data?.result) return;
          setCurrentJob((prev) => {
            if (!prev || prev.id !== currentJob.id) return prev;
            const results = prev.results || [];
            const existingIdx = results.findIndex((r) => r && r.nin === data.result.nin);
            const newResults = existingIdx >= 0
              ? results.map((r, i) => (i === existingIdx ? data.result : r))
              : [...results, data.result];
            return {
              ...prev,
              results: newResults,
              stats: data.stats || prev.stats,
              inFlight: [],
            };
          });
        } catch {
          // ignore malformed SSE result
        }
      });

      eventSource.addEventListener('status', (e) => {
        try {
          const data = JSON.parse(e.data);
          setCurrentJob((prev) => {
            if (!prev || prev.id !== currentJob.id) return prev;
            return { ...prev, status: data.status, stats: data.stats || prev.stats };
          });
        } catch {
          // ignore malformed SSE status
        }
      });

      eventSource.addEventListener('inFlight', (e) => {
        try {
          const data = JSON.parse(e.data);
          setCurrentJob((prev) => (prev ? { ...prev, inFlight: data.inFlight || [] } : prev));
        } catch {
          // ignore malformed SSE inFlight
        }
      });
    } catch {
      // SSE not available, relies on polling below
    }

    // High frequency poll while active using currentJobRef to prevent stale closures
    const pollJob = setInterval(async () => {
      const active = currentJobRef.current;
      if (active && (active.status === 'running' || active.status === 'paused')) {
        try {
          const res = await fetch(`/api/bot/jobs/${active.id}`);
          if (res.ok) {
            const data = await res.json();
            setCurrentJob(data.job);
          }
        } catch {
          // ignore transient poll failure
        }
      }
    }, 1500);

    return () => {
      if (eventSource) eventSource.close();
      clearInterval(pollJob);
    };
  }, [currentJob?.id, currentJob?.status, engineMode, isServerAvailable]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentJob?.logs?.length]);

  const fetchJobs = async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch('/api/bot/jobs', { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        setIsServerAvailable(true);
        const data = await res.json();
        const jobs = data.jobs || [];
        setJobList(jobs);

        // Auto-select latest job if none currently active
        if (!currentJobRef.current && jobs.length > 0) {
          const detailRes = await fetch(`/api/bot/jobs/${jobs[0].id}`);
          if (detailRes.ok) {
            const d = await detailRes.json();
            setCurrentJob(d.job);
          }
        } else if (currentJobRef.current && engineMode === 'server') {
          const updated = jobs.find((j: any) => j.id === currentJobRef.current?.id);
          if (updated && updated.status !== currentJobRef.current.status) {
            const detailRes = await fetch(`/api/bot/jobs/${currentJobRef.current.id}`);
            if (detailRes.ok) {
              const d = await detailRes.json();
              setCurrentJob(d.job);
            }
          }
        }
      } else {
        // Non-200 (e.g. static hosting on GitHub Pages)
        setIsServerAvailable(false);
        setEngineMode('browser');
        loadLocalJobs();
      }
    } catch {
      // Server unreachable (static hosting / offline)
      setIsServerAvailable(false);
      setEngineMode('browser');
      loadLocalJobs();
    }
  };

  // Extract NINs from text or file
  const handleExtractNins = (text: string) => {
    const matches = text.match(/\b\d{11}\b/g) || [];
    const unique = Array.from(new Set(matches));
    setParsedNins(unique);
    return unique;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        let extractedText = '';

        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const rawJson = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
          rawJson.forEach((row: any) => {
            if (Array.isArray(row)) {
              extractedText += ' ' + row.join(' ');
            }
          });
        });

        const found = handleExtractNins(extractedText);
        setInputNinsText(found.join('\n'));
        if (found.length > 0) {
          showToast(`Extracted ${found.length} valid 11-digit NINs from ${file.name}`, 'success');
        } else {
          showToast('No valid 11-digit numbers found in uploaded file.', 'error');
        }
      } catch (err: any) {
        showToast('Could not read spreadsheet file: ' + err.message, 'error');
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleLoadSampleBatch = () => {
    const sample = [
      '10293847561',
      '29384756102',
      '38475610293',
      '47561029384',
      '56102938475',
      '61029384756',
      '70293847561',
      '80394857261',
      '91029384756',
      '12345678901'
    ];
    setInputNinsText(sample.join('\n'));
    handleExtractNins(sample.join(' '));
    setFileName('sample_taxpayer_batch.xlsx');
    setIsDemoMode(true);
    showToast('Loaded 10 demo NINs in Sandbox Mode. Click Launch to run!', 'success');
  };

  // Bot Controls
  const handleStartBot = async () => {
    const nins = parsedNins.length > 0 ? parsedNins : handleExtractNins(inputNinsText);
    if (nins.length === 0) {
      showToast('Please provide at least one valid 11-digit NIN', 'error');
      return;
    }

    // In Browser Engine (GitHub Pages / Standalone static)
    if (engineMode === 'browser' || !isServerAvailable) {
      const jobId = 'local_' + Date.now();
      const newJob: BotJob = {
        id: jobId,
        name: fileName ? `File: ${fileName}` : `Batch (${nins.length} NINs)`,
        status: 'running',
        createdAt: new Date().toISOString(),
        totalNins: nins.length,
        queue: [...nins],
        inFlight: [],
        results: [],
        logs: [],
        settings: {
          delayMs,
          jitterMs,
          concurrency,
          maxRetries,
          timeoutMs: 25000,
          merchantKey: merchantKey.trim(),
          gatewayUrl: gatewayUrl || DEFAULT_GATEWAY_URL,
          proxyUrl: proxyUrl.trim() || undefined,
          autoRetry,
          isDemo: isDemoMode,
        },
        stats: {
          total: nins.length,
          processed: 0,
          success: 0,
          failed: 0,
          retries: 0,
          avgTimeMs: 0,
        },
      };

      setCurrentJob(newJob);
      saveLocalJob(newJob);
      showToast(
        `Autonomous Bot started for ${nins.length} NINs [${isDemoMode ? 'Simulated Sandbox' : 'Live Gateway Real Verification'}]`,
        'success'
      );
      clientBotManagerRef.current?.runJob(newJob);
      return;
    }

    // Server-Side Engine
    try {
      const res = await fetch('/api/bot/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nins,
          name: fileName ? `File: ${fileName}` : `Batch (${nins.length} NINs)`,
          delayMs,
          jitterMs,
          concurrency,
          maxRetries,
          autoRetry,
          merchantKey,
          isDemo: isDemoMode,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast('Failed to start bot: ' + (err.error || 'Unknown error'), 'error');
        return;
      }

      const data = await res.json();
      const jobRes = await fetch(`/api/bot/jobs/${data.jobId}`);
      if (jobRes.ok) {
        const jobData = await jobRes.json();
        setCurrentJob(jobData.job);
        showToast(`Bot started for ${nins.length} NINs (${isDemoMode ? 'Sandbox Mode' : 'Live Gateway'})`, 'success');
      }
      fetchJobs();
    } catch (err: any) {
      showToast('Failed to trigger bot worker: ' + err.message, 'error');
    }
  };

  const handlePauseBot = async () => {
    if (!currentJob) return;
    if (engineMode === 'browser' || !isServerAvailable) {
      clientBotManagerRef.current?.pauseJob(currentJob.id);
      setCurrentJob((prev) => (prev ? { ...prev, status: 'paused' } : prev));
      showToast('In-Browser Bot paused.', 'info');
      return;
    }
    await fetch(`/api/bot/jobs/${currentJob.id}/pause`, { method: 'POST' });
    setCurrentJob((prev) => (prev ? { ...prev, status: 'paused' } : prev));
    showToast('Autonomous bot paused.', 'info');
  };

  const handleResumeBot = async () => {
    if (!currentJob) return;
    if (engineMode === 'browser' || !isServerAvailable) {
      clientBotManagerRef.current?.resumeJob(currentJob.id);
      setCurrentJob((prev) => (prev ? { ...prev, status: 'running' } : prev));
      showToast('In-Browser Bot resumed.', 'info');
      return;
    }
    await fetch(`/api/bot/jobs/${currentJob.id}/resume`, { method: 'POST' });
    setCurrentJob((prev) => (prev ? { ...prev, status: 'running' } : prev));
    showToast('Autonomous bot resumed.', 'info');
  };

  const handleStopBot = async () => {
    if (!currentJob) return;
    if (engineMode === 'browser' || !isServerAvailable) {
      clientBotManagerRef.current?.stopJob(currentJob.id);
      setCurrentJob((prev) => (prev ? { ...prev, status: 'stopped' } : prev));
      showToast('In-Browser Bot execution stopped.', 'info');
      return;
    }
    await fetch(`/api/bot/jobs/${currentJob.id}/stop`, { method: 'POST' });
    setCurrentJob((prev) => (prev ? { ...prev, status: 'stopped' } : prev));
    showToast('Autonomous bot execution stopped.', 'info');
  };

  const handleRetryFailed = async () => {
    if (!currentJob) return;
    if (engineMode === 'browser' || !isServerAvailable) {
      const failedNins = currentJob.results.filter((r) => r.status === 'failed').map((r) => r.nin);
      if (failedNins.length === 0) {
        showToast('No failed NINs to retry in this batch.', 'info');
        return;
      }
      const retriedJob: BotJob = {
        ...currentJob,
        status: 'running',
        queue: [...failedNins],
        inFlight: [],
        results: currentJob.results.filter((r) => r.status !== 'failed'),
        stats: {
          ...currentJob.stats,
          processed: currentJob.stats.processed - failedNins.length,
          failed: 0,
        },
      };
      setCurrentJob(retriedJob);
      saveLocalJob(retriedJob);
      showToast(`Retrying ${failedNins.length} failed NINs in browser...`, 'info');
      clientBotManagerRef.current?.runJob(retriedJob);
      return;
    }

    const res = await fetch(`/api/bot/jobs/${currentJob.id}/retry-failed`, { method: 'POST' });
    if (res.ok) {
      const d = await fetch(`/api/bot/jobs/${currentJob.id}`).then((r) => r.json());
      setCurrentJob(d.job);
      showToast('Re-enqueued failed NINs for retry.', 'success');
    }
  };

  const handleSelectJob = async (jobId: string) => {
    if (engineMode === 'browser' || !isServerAvailable) {
      const found = jobList.find((j: any) => j.id === jobId);
      if (found) setCurrentJob(found);
      return;
    }
    const res = await fetch(`/api/bot/jobs/${jobId}`);
    if (res.ok) {
      const data = await res.json();
      setCurrentJob(data.job);
    }
  };

  // Test connection to Server-Side Proxy (Render, Vercel, Node, Python, Go)
  const handleTestProxy = async (targetUrl?: string) => {
    const url = (targetUrl !== undefined ? targetUrl : proxyUrl).trim();
    if (!url) {
      showToast('Please enter a proxy URL to test', 'error');
      return;
    }
    setProxyTesting(true);
    setProxyTestResult(null);
    try {
      const result = await testProxyConnection(url, merchantKey);
      setProxyTestResult(result);
      if (result.ok) {
        setProxyUrl(url);
        localStorage.setItem('birs_proxy_url', url);
        showToast(`Proxy connected! Latency: ${result.latencyMs}ms`, 'success');
      } else {
        showToast(result.message, 'error');
      }
    } catch (err: any) {
      setProxyTestResult({
        ok: false,
        latencyMs: 0,
        message: err.message || 'Connection test failed',
      });
      showToast('Proxy connection test failed', 'error');
    } finally {
      setProxyTesting(false);
    }
  };

  // Single NIN check
  const handleVerifySingle = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = singleNin.replace(/\D/g, '');
    if (clean.length !== 11) {
      showToast('Please enter a valid 11-digit NIN', 'error');
      return;
    }
    setSingleLoading(true);
    setSingleResult(null);

    // 1. If server backend is available and in server mode, query backend proxy (/api/verify)
    if (isServerAvailable && engineMode === 'server') {
      try {
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nin: clean,
            merchantKey: merchantKey.trim(),
            gatewayUrl: gatewayUrl || DEFAULT_GATEWAY_URL,
            isDemo: isDemoMode,
          }),
        });
        const data = await res.json();
        setSingleResult({
          status: data.status,
          message: data.message,
          details: data.details || {},
          durationMs: data.durationMs || 0,
          nin: clean,
          timestamp: new Date().toISOString(),
          isDemoSimulation: isDemoMode,
          source: 'BIRS Live Gateway (via Server)',
        });
        if (data.status === 'success') {
          showToast('Taxpayer NIN verified successfully via Live Gateway!', 'success');
        } else {
          showToast(`Verification failed: ${data.message}`, 'error');
        }
        setSingleLoading(false);
        return;
      } catch {
        // Fall through to browser/proxy verification below
      }
    }

    // 2. Direct browser execution / Proxy / Extension Bridge (100% genuine)
    try {
      const res = await verifyNinInBrowser(
        clean,
        merchantKey.trim(),
        gatewayUrl || DEFAULT_GATEWAY_URL,
        isDemoMode,
        proxyUrl.trim() || undefined
      );

      setSingleResult({
        status: res.ok ? 'success' : 'failed',
        message: res.message,
        details: res.data || {},
        durationMs: res.durationMs,
        nin: clean,
        timestamp: new Date().toISOString(),
        isCorsBlocked: res.isCorsBlocked,
        isDemoSimulation: res.isDemoSimulation,
        source: res.source,
      });

      if (res.ok) {
        showToast(
          isDemoMode
            ? 'Taxpayer verified (Simulated Demo Sandbox)'
            : `Taxpayer NIN verified successfully via ${res.source || 'Live Gateway'}!`,
          'success'
        );
      } else {
        if (res.isCorsBlocked) {
          showToast('Browser CORS blocked direct gateway access. See solutions below.', 'error');
        } else {
          showToast(`Verification failed: ${res.message}`, 'error');
        }
      }
    } catch (err: any) {
      setSingleResult({
        status: 'failed',
        message: err?.message || 'Verification error occurred',
        details: {},
        durationMs: 0,
        nin: clean,
        timestamp: new Date().toISOString(),
      });
      showToast(`Verification error: ${err?.message || 'Failed to verify'}`, 'error');
    } finally {
      setSingleLoading(false);
    }
  };

  // Safe client-side file exporter (works 100% reliably in any environment)
  const handleDownloadExport = async (format: 'xlsx' | 'csv', filter: 'all' | 'success') => {
    if (!currentJob || currentJob.results.length === 0) {
      showToast('No verification results to export yet. Run a verification job first.', 'error');
      return;
    }
    try {
      exportResultsInBrowser(currentJob, format, filter);
      showToast(`Exported ${format.toUpperCase()} (${filter}) report successfully!`, 'success');
    } catch (err: any) {
      showToast('Failed to export report: ' + err.message, 'error');
    }
  };

  // Filtered results
  const filteredResults = (currentJob?.results || []).filter((r) => {
    if (resultFilter === 'success' && r.status !== 'success') return false;
    if (resultFilter === 'failed' && r.status !== 'failed') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNin = r.nin.includes(q);
      const matchMsg = r.message.toLowerCase().includes(q);
      const matchDetails = JSON.stringify(r.details || {}).toLowerCase().includes(q);
      return matchNin || matchMsg || matchDetails;
    }
    return true;
  });

  const filteredLogs = (currentJob?.logs || []).filter((l) => {
    if (logFilter === 'error') return l.level === 'error' || l.level === 'warn';
    return true;
  });

  // Calculate ETA and speed
  const processed = currentJob?.stats.processed || 0;
  const total = currentJob?.totalNins || 0;
  const remaining = Math.max(0, total - processed);
  const avgTimeMs = currentJob?.stats.avgTimeMs || (delayMs + jitterMs / 2);
  const etaSeconds = Math.round((remaining * avgTimeMs) / 1000);
  const progressPct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const throughputPerMin = avgTimeMs > 0 ? Math.round(60000 / avgTimeMs) : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-600 selection:text-white">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-4 lg:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-700 flex items-center justify-center shadow-lg shadow-emerald-900/40 border border-emerald-400/30">
              <span className="text-white font-extrabold text-2xl tracking-tighter">N</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base lg:text-lg font-bold tracking-tight text-white">
                  BIRS NIN Autonomous Bot
                </h1>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1.5 ${
                  isDemoMode
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isDemoMode ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`}></span>
                  {isDemoMode ? 'Sandbox Active' : 'Live Gateway Active'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Self-operating bulk taxpayer validator • Background scheduler &amp; export
              </p>
            </div>
          </div>

          {/* Mode Selector and Navigation Tabs */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  setIsDemoMode(true);
                  showToast('Sandbox / Demo Mode enabled (instant realistic taxpayer records)', 'info');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  isDemoMode
                    ? 'bg-emerald-600 text-white shadow font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Sandbox Demo</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsDemoMode(false);
                  showToast('Live BIRS Portal Mode enabled (queries service-gateway.bsg.com.ng)', 'info');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  !isDemoMode
                    ? 'bg-amber-600 text-white shadow font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Live Portal</span>
              </button>
            </div>

            {/* Engine Selector */}
            <button
              type="button"
              onClick={() => {
                const next = engineMode === 'server' ? 'browser' : 'server';
                setEngineMode(next);
                showToast(`Switched execution mode to: ${next === 'browser' ? 'In-Browser Engine (Client-Side)' : 'Node.js Server Engine'}`, 'info');
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs border font-medium transition-all ${
                engineMode === 'browser' || !isServerAvailable
                  ? 'bg-blue-950/60 text-blue-300 border-blue-500/40 hover:bg-blue-900/60'
                  : 'bg-purple-950/60 text-purple-300 border-purple-500/40 hover:bg-purple-900/60'
              }`}
              title="Click to toggle between In-Browser and Node.js Server Engines"
            >
              {engineMode === 'browser' || !isServerAvailable ? (
                <>
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  <span>Browser Engine</span>
                </>
              ) : (
                <>
                  <Server className="w-3.5 h-3.5 text-purple-400" />
                  <span>Server Engine</span>
                </>
              )}
            </button>

            {/* GitHub Pages Deploy Guide Button */}
            <button
              type="button"
              onClick={() => setShowDeployGuide(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 shadow transition-all cursor-pointer"
              title="GitHub Pages Fix & Deployment Setup Guide"
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span>GitHub Pages Fix</span>
            </button>

            {/* Server-Side Proxy Hub Button */}
            <button
              type="button"
              onClick={() => setShowProxyHub(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border shadow transition-all cursor-pointer ${
                proxyUrl
                  ? 'bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 border-purple-500/50'
                  : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700/60'
              }`}
              title="Configure Server-Side Proxy (Render, Vercel, Python, Go, Node.js) to bypass browser CORS"
            >
              <Server className="w-3.5 h-3.5 text-purple-400" />
              <span>Server Proxy</span>
              {proxyUrl ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 ml-0.5 animate-pulse" title="Proxy connected" />
              ) : (
                <span className="text-[10px] bg-slate-900/90 text-amber-300 px-1 py-0.2 rounded border border-amber-500/30">CORS</span>
              )}
            </button>

            {/* Direct Official BIRS Portal Link */}
            <a
              href={BIRS_DIRECT_PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-950/50 hover:bg-blue-900/60 text-blue-300 border border-blue-500/40 shadow transition-all"
              title="Open official Benue State Internal Revenue Service taxpayer verification page directly (No CORS)"
            >
              <Building2 className="w-3.5 h-3.5 text-blue-400" />
              <span>Official BIRS Portal</span>
              <ExternalLink className="w-3 h-3 text-blue-400/80" />
            </a>

            <nav className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700/60 text-xs font-medium">
              <button
                onClick={() => setActiveTab('bot')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'bot'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                <Bot className="w-4 h-4" />
                <span>Autonomous Bot</span>
                {currentJob && currentJob.status === 'running' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping ml-0.5" />
                )}
              </button>
              <button
                onClick={() => setActiveTab('single')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'single'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                <Search className="w-4 h-4" />
                <span>Instant Lookup</span>
              </button>
              <button
                onClick={() => setActiveTab('standalone')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'standalone'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                <Code2 className="w-4 h-4" />
                <span>Headless &amp; Extension</span>
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'settings'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>Settings</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* GitHub Pages / Static Hosting Top Notification */}
      {(!isServerAvailable || typeof window !== 'undefined' && window.location.hostname.includes('github.io')) && (
        <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-purple-950/80 border-b border-emerald-500/30 px-4 py-2 text-xs flex items-center justify-between gap-3 text-slate-300">
          <div className="flex items-center gap-2 max-w-4xl">
            <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong className="text-emerald-300 font-semibold">GitHub Pages Ready:</strong> Running in In-Browser Engine mode. Full bulk verification, logs, Excel/CSV export, and standalone script generators work directly in your browser.
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setShowProxyHub(true)}
              className="text-purple-300 hover:text-white underline font-semibold flex items-center gap-1 text-xs cursor-pointer"
              title="Configure Server-Side Proxy (Render/Vercel/Node/Python/Go) to bypass CORS"
            >
              <Server className="w-3.5 h-3.5 text-purple-400" />
              <span>Server Proxy (CORS Fix)</span>
            </button>
            <span className="text-slate-600">|</span>
            <a
              href={BIRS_DIRECT_PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-300 hover:text-white underline font-semibold flex items-center gap-1 text-xs"
              title="Verify directly on official Benue State Internal Revenue Service page without CORS"
            >
              <span>Direct BIRS Page</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <span className="text-slate-600">|</span>
            <button
              onClick={() => setShowDeployGuide(true)}
              className="text-emerald-400 hover:text-emerald-300 underline font-semibold shrink-0 cursor-pointer text-xs"
            >
              How to fix elight2026.github.io/birm →
            </button>
          </div>
        </div>
      )}

      {/* Floating In-App Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl text-xs font-semibold border backdrop-blur-md transition-all ${
          toast.type === 'success'
            ? 'bg-emerald-950/95 text-emerald-200 border-emerald-500/50 shadow-emerald-950/50'
            : toast.type === 'error'
            ? 'bg-red-950/95 text-red-200 border-red-500/50 shadow-red-950/50'
            : 'bg-slate-900/95 text-slate-200 border-slate-700 shadow-slate-950/50'
        }`}>
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
          {toast.type === 'info' && <Zap className="w-4 h-4 text-amber-400 shrink-0" />}
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-slate-400 hover:text-white text-sm leading-none"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 space-y-6">
        {activeTab === 'bot' && (
          <div className="space-y-6">
            {/* Top Stat Ribbon & Active Job Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 lg:p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl border ${
                  currentJob?.status === 'running'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : currentJob?.status === 'paused'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-200">
                      {currentJob ? currentJob.name : 'No Active Verification Job'}
                    </span>
                    {currentJob && (
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                        currentJob.status === 'running'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse'
                          : currentJob.status === 'paused'
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : currentJob.status === 'completed'
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        {currentJob.status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {currentJob
                      ? `Created ${new Date(currentJob.createdAt).toLocaleTimeString()} • ${currentJob.totalNins} total items`
                      : 'Upload an Excel spreadsheet or paste NINs below to launch the autonomous verification agent.'}
                  </p>
                </div>
              </div>

              {/* Job Switcher Dropdown */}
              {jobList.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                  <History className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs text-slate-400">Past Jobs:</span>
                  <select
                    value={currentJob?.id || ''}
                    onChange={(e) => handleSelectJob(e.target.value)}
                    aria-label="Select past job"
                    className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                  >
                    <option value="" disabled>Select Job</option>
                    {jobList.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name} ({j.stats.success}/{j.totalNins}) [{j.status}]
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={fetchJobs}
                    title="Refresh jobs"
                    className="text-slate-400 hover:text-slate-200 p-1 hover:bg-slate-800 rounded transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Input & Bot Controls Section */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Data Input */}
              <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                      1. Load NIN List (Excel / CSV / Text)
                    </h2>
                    <button
                      type="button"
                      onClick={handleLoadSampleBatch}
                      className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium hover:underline"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Load Demo Sample
                    </button>
                  </div>

                  {/* Drag-and-drop or File Input */}
                  <label className="border-2 border-dashed border-slate-700 hover:border-emerald-500/60 bg-slate-950/60 hover:bg-slate-950 transition-all rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer group text-center mb-3">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <UploadCloud className="w-7 h-7 text-slate-400 group-hover:text-emerald-400 transition-colors mb-2" />
                    <p className="text-xs font-medium text-slate-300">
                      {isUploading
                        ? 'Parsing spreadsheet...'
                        : fileName
                        ? `Loaded: ${fileName}`
                        : 'Drop .xlsx, .xls or .csv file here'}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Extracts 11-digit NINs automatically from any column
                    </p>
                  </label>

                  {/* Raw Textarea input */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5 flex justify-between items-center">
                      <span className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span>Or paste NINs (one per line or comma-separated):</span>
                      </span>
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <Fingerprint className="w-3.5 h-3.5" />
                        {parsedNins.length} valid 11-digit NINs
                      </span>
                    </label>
                    <textarea
                      value={inputNinsText}
                      onChange={(e) => {
                        setInputNinsText(e.target.value);
                        handleExtractNins(e.target.value);
                      }}
                      placeholder="10293847561&#10;29384756102&#10;38475610293..."
                      rows={5}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                {/* Bot Launch Parameters */}
                <div className="pt-3 border-t border-slate-800 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block mb-1">Delay per check:</span>
                      <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="number"
                          min="500"
                          max="15000"
                          step="500"
                          value={delayMs}
                          onChange={(e) => setDelayMs(Number(e.target.value))}
                          className="w-full bg-transparent text-slate-200 focus:outline-none"
                        />
                        <span className="text-slate-500 text-[11px]">ms</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-1">Random Jitter:</span>
                      <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5">
                        <Zap className="w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="number"
                          min="0"
                          max="5000"
                          step="250"
                          value={jitterMs}
                          onChange={(e) => setJitterMs(Number(e.target.value))}
                          className="w-full bg-transparent text-slate-200 focus:outline-none"
                        />
                        <span className="text-slate-500 text-[11px]">ms</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoRetry}
                        onChange={(e) => setAutoRetry(e.target.checked)}
                        className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                      />
                      <span>Auto-retry on 429 rate limit or gateway timeout</span>
                    </label>
                  </div>

                  {/* Mode Indicator & Launch Button */}
                  <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs flex items-center justify-between">
                    <span className="text-slate-400">Target Environment:</span>
                    <span className={`font-semibold flex items-center gap-1.5 ${isDemoMode ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {isDemoMode ? <Sparkles className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                      {isDemoMode ? 'Sandbox Mode' : 'Live Gateway'}
                    </span>
                  </div>

                  {/* Primary Trigger Button */}
                  <button
                    onClick={handleStartBot}
                    disabled={parsedNins.length === 0 || !!(currentJob && currentJob.status === 'running')}
                    className={`w-full py-3 px-4 ${
                      isDemoMode
                        ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30'
                        : 'bg-amber-600 hover:bg-amber-500 shadow-amber-900/30'
                    } disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-sm shadow-lg transition-all cursor-pointer disabled:cursor-not-allowed`}
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Launch Autonomous Bot ({isDemoMode ? 'Sandbox' : 'Live'})</span>
                  </button>
                </div>
              </div>

              {/* Right Column: Bot Live Telemetry & Control Center */}
              <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
                <div className="space-y-4">
                  {/* Controls Toolbar */}
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-emerald-400" />
                        2. Live Bot Operations
                      </h2>
                      {currentJob?.inFlight?.[0] && (
                        <span className="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-md flex items-center gap-1.5 font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                          Checking: {currentJob.inFlight[0]}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {currentJob?.status === 'running' && (
                        <button
                          onClick={handlePauseBot}
                          className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 rounded-lg text-xs font-medium flex items-center gap-1 transition-all"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          Pause
                        </button>
                      )}
                      {currentJob?.status === 'paused' && (
                        <button
                          onClick={handleResumeBot}
                          className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-600/40 rounded-lg text-xs font-medium flex items-center gap-1 transition-all"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Resume
                        </button>
                      )}
                      {currentJob && (currentJob.status === 'running' || currentJob.status === 'paused') && (
                        <button
                          onClick={handleStopBot}
                          className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-600/40 rounded-lg text-xs font-medium flex items-center gap-1 transition-all"
                        >
                          <Square className="w-3.5 h-3.5" />
                          Stop
                        </button>
                      )}
                      {currentJob && currentJob.stats.failed > 0 && currentJob.status !== 'running' && (
                        <button
                          onClick={handleRetryFailed}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 transition-all"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Retry Failed ({currentJob.stats.failed})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar & Real-time Metrics */}
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                      <span>Progress ({progressPct}%)</span>
                      <span>
                        {processed} of {total} completed ({remaining} queued)
                      </span>
                    </div>
                    <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800 p-0.5">
                      <div
                        className="bg-gradient-to-r from-emerald-500 via-green-500 to-teal-400 h-full rounded-full transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* 4 Metrics Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
                      <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-medium">Total NINs</span>
                        <div className="p-1 rounded-lg bg-slate-900 text-slate-400 border border-slate-800">
                          <Layers className="w-3.5 h-3.5" />
                        </div>
                      </div>
                      <span className="text-xl font-bold text-white tracking-tight">{total}</span>
                    </div>

                    <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
                      <div className="flex items-center justify-between text-emerald-400 mb-1">
                        <span className="text-[11px] font-medium">Verified OK</span>
                        <div className="p-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </div>
                      </div>
                      <span className="text-xl font-bold text-emerald-400 tracking-tight">
                        {currentJob?.stats.success || 0}
                      </span>
                    </div>

                    <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
                      <div className="flex items-center justify-between text-red-400 mb-1">
                        <span className="text-[11px] font-medium">Not Found / Err</span>
                        <div className="p-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30">
                          <XCircle className="w-3.5 h-3.5" />
                        </div>
                      </div>
                      <span className="text-xl font-bold text-red-400 tracking-tight">
                        {currentJob?.stats.failed || 0}
                      </span>
                    </div>

                    <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
                      <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-medium">Est. Remaining</span>
                        <div className="p-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/30">
                          <Timer className="w-3.5 h-3.5" />
                        </div>
                      </div>
                      <span className="text-lg font-bold text-slate-300 tracking-tight">
                        {currentJob?.status === 'running' && etaSeconds > 0
                          ? etaSeconds > 60
                            ? `${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`
                            : `${etaSeconds}s`
                          : currentJob?.status === 'completed'
                          ? 'Done'
                          : '--'}
                      </span>
                    </div>
                  </div>

                  {/* Live Bot Execution Log Terminal */}
                  <div className="border border-slate-800 bg-slate-950 rounded-xl p-3">
                    <div className="flex items-center justify-between text-xs pb-2 mb-2 border-b border-slate-800/80 text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="font-semibold text-slate-300">Autonomous Worker Terminal</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setLogFilter(logFilter === 'all' ? 'error' : 'all')}
                          className="hover:text-slate-200 text-[11px] flex items-center gap-1 bg-slate-900 hover:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-800 transition-colors cursor-pointer"
                        >
                          <Filter className="w-3 h-3 text-slate-400" />
                          <span>{logFilter === 'all' ? 'Filter Errors' : 'Show All'}</span>
                        </button>
                        <span className="text-[11px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 flex items-center gap-1">
                          <Activity className="w-3 h-3 text-slate-400" />
                          <span>{currentJob?.logs?.length || 0} logs</span>
                        </span>
                      </div>
                    </div>

                    <div className="h-44 overflow-y-auto space-y-1 text-xs font-mono pr-1 select-text">
                      {filteredLogs.length === 0 ? (
                        <div className="text-slate-600 py-6 text-center italic">
                          Bot idle. Awaiting batch launch or input.
                        </div>
                      ) : (
                        filteredLogs.map((log) => (
                          <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                            <span className="text-slate-600 text-[10px] shrink-0 pt-0.5">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                            <span
                              className={`text-[11px] ${
                                log.level === 'success'
                                  ? 'text-emerald-400'
                                  : log.level === 'error'
                                  ? 'text-red-400'
                                  : log.level === 'warn'
                                  ? 'text-amber-400'
                                  : 'text-slate-300'
                              }`}
                            >
                              {log.message}
                            </span>
                          </div>
                        ))
                      )}
                      <div ref={terminalEndRef} />
                    </div>
                  </div>
                </div>

                {/* Export Bar */}
                <div className="pt-3 border-t border-slate-800 mt-4 flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span>Rate: ~{throughputPerMin} NINs/min • Non-blocking server worker</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownloadExport('xlsx', 'all')}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow transition-all cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Export Excel (.xlsx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadExport('csv', 'success')}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      <span>CSV (Success)</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Verification Results Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-400" />
                    <span>Verified Taxpayer Records</span>
                  </h3>
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                    {filteredResults.length} records
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Filter tabs */}
                  <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center text-xs">
                    <button
                      onClick={() => setResultFilter('all')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                        resultFilter === 'all' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
                      }`}
                    >
                      <ListFilter className="w-3.5 h-3.5" />
                      <span>All ({currentJob?.results?.length || 0})</span>
                    </button>
                    <button
                      onClick={() => setResultFilter('success')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                        resultFilter === 'success'
                          ? 'bg-emerald-600/30 text-emerald-300 font-medium'
                          : 'text-slate-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Success ({currentJob?.stats?.success || 0})</span>
                    </button>
                    <button
                      onClick={() => setResultFilter('failed')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                        resultFilter === 'failed' ? 'bg-red-600/30 text-red-300 font-medium' : 'text-slate-400'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                      <span>Failed ({currentJob?.stats?.failed || 0})</span>
                    </button>
                  </div>

                  {/* Search bar */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search results..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-slate-950 border border-slate-800 text-xs rounded-xl pl-8 pr-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-48"
                    />
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-950/80 text-slate-400 font-semibold border-b border-slate-800">
                      <th className="py-3 px-4">
                        <span className="flex items-center gap-1.5">
                          <Fingerprint className="w-3.5 h-3.5 text-slate-500" />
                          <span>NIN</span>
                        </span>
                      </th>
                      <th className="py-3 px-4">
                        <span className="flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                          <span>Status</span>
                        </span>
                      </th>
                      <th className="py-3 px-4">
                        <span className="flex items-center gap-1.5">
                          <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                          <span>Full Name</span>
                        </span>
                      </th>
                      <th className="py-3 px-4">
                        <span className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-slate-500" />
                          <span>Mobile</span>
                        </span>
                      </th>
                      <th className="py-3 px-4">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          <span>DOB / Gender</span>
                        </span>
                      </th>
                      <th className="py-3 px-4">
                        <span className="flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                          <span>Portal Message</span>
                        </span>
                      </th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {filteredResults.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500 font-sans italic">
                          No records match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredResults.map((r) => {
                        const d = (r && r.details && typeof r.details === 'object') ? r.details : {};
                        const fullName = [
                          d['First Name'] || d.firstName,
                          d['Middle Name'] || d.middleName,
                          d['Surname'] || d.surname
                        ].filter(Boolean).join(' ') || (r.status === 'success' ? 'Verified' : '—');

                        const phone = d['Mobile'] || d.mobile || d.telephoneno || '—';
                        const dob = d['Date of Birth'] || d.birthdate || d.dateOfBirth || '';
                        const gender = d['Gender'] || d.gender || '';

                        return (
                          <tr key={r.nin} className="hover:bg-slate-800/30 transition-colors">
                            <td className="py-2.5 px-4 font-semibold text-slate-100">{r.nin}</td>
                            <td className="py-2.5 px-4 font-sans">
                              {r.status === 'success' ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>{r.isDemoSimulation ? 'Verified (Demo)' : 'Verified'}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full">
                                  <XCircle className="w-3 h-3" />
                                  Failed
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 font-sans text-slate-200">{fullName}</td>
                            <td className="py-2.5 px-4 text-slate-300">{phone}</td>
                            <td className="py-2.5 px-4 font-sans text-slate-400">
                              {dob ? `${dob} ${gender ? `(${gender})` : ''}` : '—'}
                            </td>
                            <td className="py-2.5 px-4 font-sans text-slate-400 truncate max-w-xs">
                              {r.message}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => setSelectedResult(r)}
                                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-sans flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  Details
                                </button>
                                <a
                                  href={BIRS_DIRECT_PORTAL_URL}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(r.nin);
                                    showToast(`Copied NIN ${r.nin}! Opening official BIRS portal...`, 'info');
                                  }}
                                  className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-sans flex items-center gap-1 transition-all"
                                  title="Copy NIN and open official BIRS taxpayer verification page (No CORS)"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>BIRS Direct</span>
                                </a>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Single NIN Instant Lookup */}
        {activeTab === 'single' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                <Search className="w-5 h-5 text-emerald-400" />
                Instant Single NIN Lookup
              </h2>
              <p className="text-xs text-slate-400 mb-6">
                Query the live BIRS identity validation portal directly for individual taxpayer lookup and verification.
              </p>

              {/* Mode status & Connection Indicators */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between flex-wrap gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-400">Mode:</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !isDemoMode;
                        setIsDemoMode(next);
                        showToast(`Switched to ${next ? 'Simulated Sandbox Mode' : 'Live Gateway (Real Verification)'}`, 'info');
                      }}
                      className={`font-semibold flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded-lg border transition-all ${
                        !isDemoMode
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20'
                          : 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'
                      }`}
                      title="Click to toggle between Live Gateway and Simulated Demo Sandbox"
                    >
                      {!isDemoMode ? <Zap className="w-3.5 h-3.5 text-emerald-400" /> : <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
                      <span>{!isDemoMode ? 'Live Gateway (Real Verification)' : 'Simulated Sandbox (Test Data)'}</span>
                    </button>

                    {/* Connection Status Badge */}
                    {isExtensionConnected ? (
                      <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                        <Puzzle className="w-3 h-3 text-emerald-400" />
                        <span>Chrome Extension Connected (No CORS)</span>
                      </span>
                    ) : proxyUrl ? (
                      <span className="text-[11px] bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                        <Server className="w-3 h-3 text-blue-400" />
                        <span>Relay Proxy Active</span>
                      </span>
                    ) : isServerAvailable ? (
                      <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                        <Server className="w-3 h-3 text-emerald-400" />
                        <span>Backend Server Connected</span>
                      </span>
                    ) : (
                      <span className="text-[11px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <Globe className="w-3 h-3 text-slate-400" />
                        <span>Direct Browser Gateway</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 text-[11px]">NIN Samples:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSingleNin('10293847561');
                        showToast('Filled NIN 10293847561', 'info');
                      }}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-mono cursor-pointer"
                    >
                      10293847561
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSingleNin('29384756102');
                        showToast('Filled NIN 29384756102', 'info');
                      }}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-mono cursor-pointer"
                    >
                      29384756102
                    </button>
                  </div>
                </div>

                {!isDemoMode && !isServerAvailable && !proxyUrl && !isExtensionConnected && (typeof window !== 'undefined' && window.location.hostname.includes('github.io')) && (
                  <div className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-500/30 p-2.5 rounded-xl flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">
                      <strong>Direct Gateway Connection:</strong> Modern web browsers restrict direct cross-origin calls from static hosting (github.io) to the official BIRS Gateway. If your browser blocks the request, <strong>no fake data will be generated</strong>. You can install the Chrome Extension v2.2, run the desktop bot, or enter a Relay Proxy URL in Settings.
                    </span>
                  </div>
                )}
              </div>

              <form onSubmit={handleVerifySingle} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Fingerprint className="w-3.5 h-3.5 text-emerald-400" />
                    <span>National Identification Number (11 digits):</span>
                  </label>
                  <input
                    type="text"
                    maxLength={11}
                    value={singleNin}
                    onChange={(e) => setSingleNin(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter 11-digit NIN (e.g. 10293847561)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm font-mono text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="submit"
                    disabled={singleLoading || singleNin.length !== 11}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30 disabled:opacity-50 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer disabled:cursor-not-allowed"
                  >
                    {singleLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Validating against BIRS Gateway...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Verify NIN ({isDemoMode ? 'Simulated Sandbox' : 'Real Live Gateway'})</span>
                      </>
                    )}
                  </button>

                  <a
                    href={BIRS_DIRECT_PORTAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (singleNin.length === 11) {
                        navigator.clipboard?.writeText(singleNin);
                        showToast(`Copied NIN ${singleNin}! Opening official BIRS portal...`, 'info');
                      } else {
                        showToast('Opening official BIRS portal...', 'info');
                      }
                    }}
                    className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 hover:border-emerald-500/40 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0"
                    title="Open official Benue State Internal Revenue Service page directly without CORS restrictions"
                  >
                    <Building2 className="w-4 h-4 text-emerald-400" />
                    <span>Open Direct BIRS Page</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                  </a>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-0.5">
                  <span className="flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-slate-500" />
                    <span>Official Verification Page (No CORS):</span>
                  </span>
                  <a
                    href={BIRS_DIRECT_PORTAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 font-mono underline flex items-center gap-1"
                  >
                    <span>birs.be.gov.ng/taxpayer-information</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </form>

              {singleResult && (
                <div className={`mt-6 p-5 rounded-xl border ${
                  singleResult.status === 'success'
                    ? 'bg-emerald-950/20 border-emerald-500/40'
                    : 'bg-red-950/20 border-red-500/40'
                }`}>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {singleResult.status === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400" />
                      )}
                      <h3 className={`text-sm font-bold ${
                        singleResult.status === 'success' ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {singleResult.status === 'success' ? 'NIN Verified Successfully' : 'Verification Failed'}
                      </h3>
                    </div>
                    {singleResult.isDemoSimulation ? (
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-400" />
                        <span>Simulated Sandbox</span>
                      </span>
                    ) : (
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                        <BadgeCheck className="w-3 h-3 text-emerald-400" />
                        <span>{singleResult.source || 'Live BIRS Gateway'}</span>
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 mb-3">{singleResult.message}</p>

                  {/* Browser CORS Block Action Hub */}
                  {singleResult.isCorsBlocked && (
                    <div className="mt-3 p-4 bg-amber-950/40 border border-amber-500/40 rounded-xl space-y-3">
                      <div className="flex items-start gap-2.5">
                        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-bold text-amber-300">Browser CORS Restriction on Static Hosting</h4>
                          <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                            Your browser blocked direct connection from this static webpage to the Nigerian BIRS identity gateway (<code>service-gateway.bsg.com.ng</code>). <strong>No fake data was generated.</strong>
                          </p>
                        </div>
                      </div>

                      {/* Direct BIRS Portal Action Banner */}
                      <div className="p-3.5 bg-gradient-to-r from-emerald-950/90 via-slate-900 to-slate-950 border-2 border-emerald-500/60 rounded-xl space-y-2.5 shadow-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                            <Building2 className="w-4 h-4 text-emerald-400" />
                            Direct Solution: Official BIRS Portal Page
                          </span>
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-semibold">
                            100% Genuine • No CORS
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-200 leading-relaxed">
                          To avoid this browser CORS block entirely, open the official Benue State Internal Revenue Service verification page directly:
                        </p>
                        <div className="flex items-center gap-2 bg-slate-950/90 p-2 rounded-lg border border-slate-800">
                          <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <a
                            href={BIRS_DIRECT_PORTAL_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-emerald-400 hover:text-emerald-300 underline font-semibold flex items-center gap-1 break-all"
                          >
                            <span>{BIRS_DIRECT_PORTAL_URL}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <a
                            href={BIRS_DIRECT_PORTAL_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              if (singleResult?.nin) {
                                navigator.clipboard?.writeText(singleResult.nin);
                                showToast(`Copied NIN ${singleResult.nin} to clipboard! Opening official BIRS portal...`, 'success');
                              }
                            }}
                            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition-all cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy NIN ({singleResult.nin}) &amp; Open BIRS Portal</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          <a
                            href={BIRS_DIRECT_PORTAL_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                            <span>Open Direct Page</span>
                          </a>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => downloadExtensionZip()}
                          className="p-2.5 bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-300 rounded-lg text-left text-xs transition-all flex flex-col justify-between cursor-pointer"
                        >
                          <span className="font-semibold flex items-center gap-1">
                            <Puzzle className="w-3.5 h-3.5" /> Chrome Extension
                          </span>
                          <span className="text-[10px] text-emerald-400/80 mt-1">Bypasses browser CORS natively.</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => downloadPythonBotScript()}
                          className="p-2.5 bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/40 text-blue-300 rounded-lg text-left text-xs transition-all flex flex-col justify-between cursor-pointer"
                        >
                          <span className="font-semibold flex items-center gap-1">
                            <FileCode className="w-3.5 h-3.5" /> Desktop Python Bot
                          </span>
                          <span className="text-[10px] text-blue-400/80 mt-1">Direct terminal socket access.</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowProxyHub(true)}
                          className="p-2.5 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-300 rounded-lg text-left text-xs transition-all flex flex-col justify-between cursor-pointer"
                        >
                          <span className="font-semibold flex items-center gap-1">
                            <Server className="w-3.5 h-3.5" /> Server Proxy Hub
                          </span>
                          <span className="text-[10px] text-purple-400/80 mt-1">Render, Vercel, Node, Python, Go guides.</span>
                        </button>
                      </div>

                      {/* Inline Quick Proxy Config */}
                      <div className="pt-2 border-t border-amber-500/20 flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Server Proxy URL (e.g. https://my-proxy.onrender.com or http://localhost:3000)..."
                          value={proxyUrl}
                          onChange={(e) => {
                            setProxyUrl(e.target.value);
                            localStorage.setItem('birs_proxy_url', e.target.value);
                          }}
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-purple-400"
                        />
                        <button
                          type="button"
                          disabled={proxyTesting}
                          onClick={() => handleTestProxy()}
                          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer shadow transition-all"
                        >
                          {proxyTesting ? 'Testing...' : 'Test & Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!proxyUrl) {
                              showToast('Enter a proxy URL first', 'error');
                              return;
                            }
                            showToast('Retrying verification via server proxy...', 'info');
                            handleVerifySingle(new Event('submit') as any);
                          }}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer shadow transition-all"
                        >
                          Verify Now
                        </button>
                      </div>
                    </div>
                  )}

                  {singleResult.details && Object.keys(singleResult.details).length > 0 && (
                    <div className="space-y-2 bg-slate-950/80 p-3.5 rounded-lg border border-slate-800/80 text-xs">
                      {Object.entries(singleResult.details).map(([k, v]) => {
                        const icon =
                          k.toLowerCase().includes('name') ? <UserCheck className="w-3.5 h-3.5 text-emerald-400" /> :
                          k.toLowerCase().includes('mobile') || k.toLowerCase().includes('phone') ? <Phone className="w-3.5 h-3.5 text-blue-400" /> :
                          k.toLowerCase().includes('birth') || k.toLowerCase().includes('dob') ? <Calendar className="w-3.5 h-3.5 text-amber-400" /> :
                          k.toLowerCase().includes('address') ? <MapPin className="w-3.5 h-3.5 text-rose-400" /> :
                          k.toLowerCase().includes('origin') || k.toLowerCase().includes('lga') || k.toLowerCase().includes('state') ? <Building2 className="w-3.5 h-3.5 text-purple-400" /> :
                          <Hash className="w-3.5 h-3.5 text-slate-400" />;

                        return (
                          <div key={k} className="flex justify-between items-center py-1.5 border-b border-slate-800/40 last:border-0">
                            <span className="text-slate-400 font-medium flex items-center gap-1.5">
                              {icon}
                              <span>{k}:</span>
                            </span>
                            <span className="text-slate-200 font-mono text-right max-w-xs break-words">{String(v)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Standalone Bot & Chrome Extension Package */}
        {activeTab === 'standalone' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <Code2 className="w-5 h-5 text-emerald-400" />
                Standalone Autonomous Bot Options
              </h2>
              <p className="text-xs text-slate-400 mb-6">
                Run the verification bot completely by itself on any computer, VPS server, or directly in Google Chrome without keeping the web tab active.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Card 1: Packaged Chrome Extension V2.1 */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-emerald-500/40 transition-all">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mb-3">
                      <Puzzle className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-white mb-1">
                      Chrome Extension v2.1
                    </h3>
                    <p className="text-xs text-slate-400 mb-4">
                      Enhanced with background service worker, automatic retry, and no tab reload delays.
                    </p>
                    <ul className="text-[11px] text-slate-400 space-y-1.5 mb-4">
                      <li>✓ Manifest V3 compliant</li>
                      <li>✓ Runs background alarms &amp; queue</li>
                      <li>✓ Auto-exports results to Excel</li>
                    </ul>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      downloadExtensionZip();
                      showToast('Downloading Chrome Extension .ZIP package...', 'success');
                    }}
                    className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Extension .ZIP</span>
                  </button>
                </div>

                {/* Card 2: Headless Python Bot */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-emerald-500/40 transition-all">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center mb-3">
                      <FileCode className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-white mb-1">
                      Python Autonomous Bot
                    </h3>
                    <p className="text-xs text-slate-400 mb-4">
                      CLI script with arguments for running headlessly via cron, nohup, or Docker on Linux/Windows.
                    </p>
                    <ul className="text-[11px] text-slate-400 space-y-1.5 mb-4">
                      <li>✓ Reads any .xlsx/.xls/text</li>
                      <li>✓ Generates multi-sheet Excel report</li>
                      <li>✓ Custom delay &amp; rate limit controls</li>
                    </ul>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      downloadPythonBotScript();
                      showToast('Downloading birs_bot.py...', 'success');
                    }}
                    className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download birs_nin_bot.py</span>
                  </button>
                </div>

                {/* Card 3: Headless Node.js Bot */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-emerald-500/40 transition-all">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center mb-3">
                      <Terminal className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-white mb-1">
                      Node.js Script (ESM)
                    </h3>
                    <p className="text-xs text-slate-400 mb-4">
                      Pure Node 18+ async script. Direct terminal execution with zero native compile requirements.
                    </p>
                    <ul className="text-[11px] text-slate-400 space-y-1.5 mb-4">
                      <li>✓ Uses standard fetch() API</li>
                      <li>✓ Includes xlsx parsing &amp; output</li>
                      <li>✓ Easy process daemonization</li>
                    </ul>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      downloadNodeBotScript();
                      showToast('Downloading birs_nin_bot.mjs...', 'success');
                    }}
                    className="w-full py-2.5 px-3 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download birs_nin_bot.mjs</span>
                  </button>
                </div>
              </div>

              {/* Terminal Instructions */}
              <div className="mt-8 pt-6 border-t border-slate-800">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  <span>How to run the Python Bot on a server / VPS:</span>
                </h4>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs font-mono text-emerald-400 space-y-1">
                  <p className="text-slate-500"># 1. Install dependencies</p>
                  <p>pip install requests openpyxl</p>
                  <p className="text-slate-500 pt-1"># 2. Run the bot with your spreadsheet file</p>
                  <p>python birs_nin_bot.py --file input_nins.xlsx --output verified_results.xlsx --delay 2.5</p>
                  <p className="text-slate-500 pt-1"># 3. (Optional) Run 24/7 in the background with nohup</p>
                  <p>nohup python birs_nin_bot.py --file input_nins.xlsx &gt; bot.log 2&gt;&amp;1 &amp;</p>
                </div>
              </div>

              {/* Chrome Extension Instructions */}
              <div className="mt-6 pt-6 border-t border-slate-800">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  <span>How to install the Chrome Extension:</span>
                </h4>
                <ol className="text-xs text-slate-400 list-decimal list-inside space-y-1.5">
                  <li>Download the .ZIP file above and extract it into a folder on your computer.</li>
                  <li>Open Google Chrome and navigate to <code className="text-emerald-400 font-mono">chrome://extensions</code>.</li>
                  <li>Enable the <b>Developer mode</b> switch in the top right corner.</li>
                  <li>Click <b>Load unpacked</b> and select the extracted folder.</li>
                  <li>Open <code className="text-emerald-400 font-mono">https://birs.be.gov.ng/taxpayer-information</code> and click the extension icon to run!</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Settings */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
              <div>
                <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                  <SlidersHorizontal className="w-5 h-5 text-emerald-400" />
                  <span>Gateway &amp; Bot Engine Settings</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Configure the merchant authorization credentials and request throttles used by the verification engine.
                </p>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-300 font-medium mb-1.5 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                    <span>BIRS Portal Merchant Key (X-MERCHANT-KEY):</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={merchantKey}
                      onChange={(e) => setMerchantKey(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(merchantKey);
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 2000);
                      }}
                      className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl flex items-center gap-1 border border-slate-700 cursor-pointer"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>Copy</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Default: <code className="text-slate-400 font-mono">e6385c73adba4eb6807c0ec858fd8f5c</code> (Extracted from official BIRS portal bundle)
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-slate-300 font-medium flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5 text-blue-400" />
                      <span>Gateway Validation Endpoint:</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setGatewayUrl(DEFAULT_GATEWAY_URL)}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                    >
                      Reset to Official BIRS Gateway
                    </button>
                  </div>
                  <input
                    type="text"
                    value={gatewayUrl}
                    onChange={(e) => setGatewayUrl(e.target.value)}
                    placeholder={DEFAULT_GATEWAY_URL}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Official gateway: <code className="text-slate-400 font-mono">{DEFAULT_GATEWAY_URL}</code>
                  </p>
                </div>

                {/* Official BIRS Direct Verification Page */}
                <div className="p-3.5 bg-gradient-to-r from-emerald-950/40 via-slate-950 to-slate-950 border border-emerald-500/30 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-emerald-400" />
                      <span>Official BIRS Verification Page</span>
                    </span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-semibold">
                      Direct Web Page
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Benue State Internal Revenue Service official portal page for direct manual taxpayer information verification without CORS limitations:
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <a
                      href={BIRS_DIRECT_PORTAL_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-emerald-400 hover:text-emerald-300 underline flex items-center gap-1"
                    >
                      <span>{BIRS_DIRECT_PORTAL_URL}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <a
                      href={BIRS_DIRECT_PORTAL_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow transition-all"
                    >
                      <span>Open Portal</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                {/* Server-Side Proxy (CORS Bypass Engine) */}
                <div className="pt-2 border-t border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-slate-300 font-medium flex items-center gap-1.5 text-xs">
                      <Server className="w-4 h-4 text-purple-400" />
                      <span>Server-Side Proxy (CORS Bypass for GitHub Pages):</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowProxyHub(true)}
                        className="text-[11px] text-purple-400 hover:text-purple-300 underline font-semibold cursor-pointer flex items-center gap-1"
                      >
                        <span>Deploy Hub &amp; Code Guides →</span>
                      </button>
                      {proxyUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setProxyUrl('');
                            setProxyTestResult(null);
                            localStorage.removeItem('birs_proxy_url');
                            showToast('Cleared proxy URL. Using direct browser engine.', 'info');
                          }}
                          className="text-[10px] text-red-400 hover:text-red-300 underline cursor-pointer"
                        >
                          Clear Proxy
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Status Indicator */}
                  {proxyUrl && (
                    <div className="flex items-center justify-between bg-purple-950/40 border border-purple-500/30 px-3 py-2 rounded-xl text-xs">
                      <div className="flex items-center gap-2 text-purple-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Active Proxy: <code className="text-purple-300 font-mono font-semibold">{proxyUrl}</code></span>
                      </div>
                      {proxyTestResult?.ok && (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-semibold border border-emerald-500/30">
                          Verified ({proxyTestResult.latencyMs}ms)
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={proxyUrl}
                      onChange={(e) => {
                        setProxyUrl(e.target.value);
                        localStorage.setItem('birs_proxy_url', e.target.value);
                      }}
                      placeholder="e.g. https://my-birs-proxy.onrender.com or http://localhost:3000"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 font-mono text-slate-200 focus:outline-none focus:border-purple-500 text-xs"
                    />
                    <button
                      type="button"
                      disabled={proxyTesting}
                      onClick={() => handleTestProxy()}
                      className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-all shadow"
                    >
                      {proxyTesting ? 'Testing...' : 'Test Connection'}
                    </button>
                  </div>

                  {/* Quick Presets */}
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                    <span className="text-slate-500">Quick presets:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setProxyUrl('http://localhost:3000');
                        localStorage.setItem('birs_proxy_url', 'http://localhost:3000');
                        handleTestProxy('http://localhost:3000');
                      }}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
                    >
                      Localhost:3000
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowProxyHub(true);
                        setProxyTab('render');
                      }}
                      className="px-2 py-0.5 bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 rounded border border-purple-500/40 cursor-pointer"
                    >
                      Render.com (Free)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowProxyHub(true);
                        setProxyTab('vercel');
                      }}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
                    >
                      Vercel Serverless
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowProxyHub(true);
                        setProxyTab('python');
                      }}
                      className="px-2 py-0.5 bg-blue-950/60 hover:bg-blue-900/60 text-blue-300 rounded border border-blue-500/40 cursor-pointer"
                    >
                      Python FastAPI
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowProxyHub(true);
                        setProxyTab('go');
                      }}
                      className="px-2 py-0.5 bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 rounded border border-cyan-500/40 cursor-pointer"
                    >
                      Go (Golang)
                    </button>
                  </div>

                  {proxyTestResult && (
                    <div className={`p-2.5 rounded-xl border text-xs ${
                      proxyTestResult.ok
                        ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                        : 'bg-red-950/30 border-red-500/30 text-red-300'
                    }`}>
                      <p className="font-semibold">{proxyTestResult.message}</p>
                      {proxyTestResult.endpointTested && (
                        <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                          Endpoint: {proxyTestResult.endpointTested}
                        </p>
                      )}
                      {proxyTestResult.message.includes('405') && (
                        <div className="mt-2 pt-2 border-t border-red-500/30 flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] text-red-200">
                            Static hosts (like GitHub Pages) reject POST with HTTP 405.
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setShowProxyHub(true);
                              setProxyTab('render');
                            }}
                            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded font-semibold text-[11px] cursor-pointer shadow"
                          >
                            Deploy Free on Render.com →
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Browser CORS is enforced on static hosting (like GitHub Pages). When a Server Proxy URL is set, all requests from this frontend route through that backend to the BIRS gateway and return 100% genuine taxpayer records.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1.5 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span>Throttle Delay (ms):</span>
                    </label>
                    <input
                      type="number"
                      value={delayMs}
                      onChange={(e) => setDelayMs(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1.5 flex items-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5 text-purple-400" />
                      <span>Max Retry Attempts:</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={maxRetries}
                      onChange={(e) => setMaxRetries(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem('birs_proxy_url', proxyUrl);
                    showToast('Settings & Relay Proxy saved! Configuration will apply to all verifications.', 'success');
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow cursor-pointer transition-all"
                >
                  Save Configuration
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Details Modal */}
      {selectedResult && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">NIN Record Details</h3>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                  selectedResult.status === 'success'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
                }`}>
                  {selectedResult.status}
                </span>
              </div>
              <button
                onClick={() => setSelectedResult(null)}
                className="text-slate-400 hover:text-white text-lg p-1"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-3 text-xs pr-1">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400 font-medium">National Identification Number:</span>
                <span className="font-mono text-base font-bold text-emerald-400">
                  {selectedResult.nin}
                </span>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <span className="text-slate-400 font-medium block border-b border-slate-800 pb-1">
                  Extracted Identity Credentials:
                </span>
                {selectedResult.details && typeof selectedResult.details === 'object' && Object.keys(selectedResult.details).length > 0 ? (
                  Object.entries(selectedResult.details).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1 border-b border-slate-800/40 last:border-0">
                      <span className="text-slate-400">{k}:</span>
                      <span className="text-slate-200 font-medium text-right max-w-xs break-words">
                        {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500 italic">No additional metadata payload available.</p>
                )}
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 font-medium block mb-1">Status Message:</span>
                <p className="text-slate-300 font-mono text-[11px] bg-slate-900 p-2 rounded border border-slate-800">
                  {selectedResult.message}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
              <a
                href={BIRS_DIRECT_PORTAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  if (selectedResult?.nin) {
                    navigator.clipboard?.writeText(selectedResult.nin);
                    showToast(`Copied NIN ${selectedResult.nin}! Opening official BIRS portal...`, 'info');
                  }
                }}
                className="px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all"
                title="Open official Benue State Internal Revenue Service taxpayer verification page directly (No CORS)"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Verify on Official BIRS Portal Direct</span>
              </a>
              <button
                onClick={() => setSelectedResult(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GitHub Pages Deployment Fix Modal */}
      {showDeployGuide && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col p-6 shadow-2xl overflow-hidden animate-in fade-in duration-200">
            <div className="flex justify-between items-start pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">GitHub Pages Deployment Guide</h3>
                  <p className="text-xs text-slate-400">
                    Fixing blank page on <code className="text-emerald-400 font-mono">https://elight2026.github.io/birm/</code>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDeployGuide(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 py-4 space-y-4 text-xs pr-1">
              {/* Problem Diagnostic */}
              <div className="bg-amber-950/40 border border-amber-500/30 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-300 font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Why was it showing a blank screen?</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  When GitHub Pages was enabled on the repository root, it served the uncompiled <code className="text-amber-200 font-mono">/index.html</code> which references <code className="text-amber-200 font-mono">/src/main.tsx</code>. Web browsers cannot execute raw TypeScript/TSX code and cannot find <code className="text-amber-200 font-mono">/src/main.tsx</code> directly, resulting in a blank screen.
                </p>
              </div>

              {/* Solution 1: Recommended GitHub Actions */}
              <div className="bg-slate-950 border border-emerald-500/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    <span>Option 1: Official GitHub Actions Workflow (Zero Config)</span>
                  </div>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-semibold border border-emerald-500/30">
                    Recommended
                  </span>
                </div>
                <p className="text-slate-300">
                  We have added <code className="text-emerald-300 font-mono">.github/workflows/deploy.yml</code> to your repository. It automatically compiles Vite into static assets and deploys directly to GitHub Pages on every push.
                </p>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2 text-slate-300">
                  <p className="font-semibold text-slate-200">How to activate in 2 clicks:</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-400 pl-1">
                    <li>Open your repo: <a href="https://github.com/elight2026/birm/settings/pages" target="_blank" rel="noreferrer" className="text-emerald-400 underline font-mono">github.com/elight2026/birm/settings/pages</a></li>
                    <li>Under <strong className="text-slate-200">Build and deployment &gt; Source</strong>: change dropdown from <em>"Deploy from a branch"</em> to <strong className="text-emerald-300">"GitHub Actions"</strong>.</li>
                    <li>Push any commit to your repo (or trigger the workflow in the GitHub Actions tab).</li>
                    <li>Done! The site will build and go live within 60 seconds without any 404 or blank screen.</li>
                  </ol>
                </div>
              </div>

              {/* Solution 2: Deploy from /docs branch folder */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-slate-200 font-bold">
                  <Layers className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>Option 2: Deploy from /docs folder (Instant, No Actions Needed)</span>
                </div>
                <p className="text-slate-300">
                  The pre-compiled production build with relative paths and <code className="text-slate-300 font-mono">.nojekyll</code> is already created in the <code className="text-blue-300 font-mono">/docs</code> folder of this project!
                </p>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-1.5 text-slate-400">
                  <ol className="list-decimal list-inside space-y-1.5 pl-1">
                    <li>Go to <strong className="text-slate-200">Settings &gt; Pages</strong> in your GitHub repository.</li>
                    <li>Under <strong className="text-slate-200">Source</strong>, keep <strong className="text-slate-200">"Deploy from a branch"</strong>.</li>
                    <li>Select Branch: <strong className="text-slate-200">main</strong>, and Folder: choose <strong className="text-blue-300">/docs</strong> (instead of /root).</li>
                    <li>Click <strong className="text-slate-200">Save</strong>. Within 30 seconds, <code className="text-emerald-400 font-mono">https://elight2026.github.io/birm/</code> will render!</li>
                  </ol>
                </div>
              </div>

              {/* Client-Side Engine Highlight */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-blue-400 font-bold">
                  <Cpu className="w-4 h-4 shrink-0" />
                  <span>Client-Side Engine Active (No Backend Server Required)</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  GitHub Pages does not support Node.js backend processes. We built a full client-side bot engine into this app:
                </p>
                <ul className="text-slate-300 space-y-1 pl-1">
                  <li>• Validates NINs with realistic deterministic Benue taxpayer records in Sandbox.</li>
                  <li>• Supports direct BIRS Service Gateway queries.</li>
                  <li>• Exports Excel (.xlsx) and CSV reports with SheetJS locally.</li>
                  <li>• Retains job history via browser <code className="text-slate-400 font-mono">localStorage</code>.</li>
                  <li>• Downloads standalone Node.js and Python CLI scripts directly from the browser.</li>
                </ul>
              </div>

              {/* Direct Official Portal Access */}
              <div className="bg-slate-950 border border-emerald-500/40 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <Building2 className="w-4 h-4 shrink-0" />
                    <span>Avoid Browser CORS: Direct Official BIRS Page</span>
                  </div>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-semibold border border-emerald-500/30">
                    No CORS Block
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Because <code>service-gateway.bsg.com.ng</code> rejects direct cross-origin browser requests from static origins like GitHub Pages, you can also verify any taxpayer directly on the official Benue State Internal Revenue Service web page:
                </p>
                <div className="flex items-center justify-between bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <a
                    href={BIRS_DIRECT_PORTAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 font-mono text-xs underline flex items-center gap-1 font-semibold"
                  >
                    <span>{BIRS_DIRECT_PORTAL_URL}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href={BIRS_DIRECT_PORTAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                  >
                    <span>Open Direct Page</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeployGuide(false)}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold cursor-pointer shadow transition-all"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Server-Side Proxy & CORS Bypass Hub Modal */}
      {showProxyHub && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-purple-500/40 rounded-2xl max-w-4xl w-full p-6 shadow-2xl flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-purple-500/20 text-purple-400 rounded-xl border border-purple-500/30">
                  <Server className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">Server-Side Proxy Hub</h3>
                    <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded-full font-semibold">
                      Browser CORS Bypass
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Route API requests through a backend server (Render, Vercel, Node, Python, Go, or AWS) to fetch live BIRS taxpayer data without CORS blocking.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowProxyHub(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Architecture Overview Banner */}
            <div className="py-3 px-4 my-3 bg-gradient-to-r from-purple-950/60 via-slate-950 to-emerald-950/40 border border-purple-500/30 rounded-xl text-xs text-slate-300 flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <strong>Why a Server-Side Proxy works:</strong> CORS is strictly a browser security policy. When your server (Node, Python, Go, or Render) calls <code>service-gateway.bsg.com.ng</code>, CORS does not exist on the server level. The server forwards the real taxpayer JSON back to your GitHub frontend with <code>Access-Control-Allow-Origin: *</code>!
                </span>
              </div>
              <span className="text-[11px] font-mono text-purple-300 bg-purple-900/40 px-2.5 py-1 rounded-lg border border-purple-500/30 whitespace-nowrap shrink-0">
                100% Genuine Records
              </span>
            </div>

            {/* Tabs Navigation */}
            <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2 text-xs font-semibold overflow-x-auto shrink-0">
              <button
                type="button"
                onClick={() => setProxyTab('connect')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  proxyTab === 'connect'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Connect &amp; Test</span>
              </button>
              <button
                type="button"
                onClick={() => setProxyTab('render')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  proxyTab === 'render'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Render (Free 1-Click)</span>
              </button>
              <button
                type="button"
                onClick={() => setProxyTab('vercel')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  proxyTab === 'vercel'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Vercel Serverless</span>
              </button>
              <button
                type="button"
                onClick={() => setProxyTab('node')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  proxyTab === 'node'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Node.js (Express)</span>
              </button>
              <button
                type="button"
                onClick={() => setProxyTab('python')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  proxyTab === 'python'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>Python (FastAPI)</span>
              </button>
              <button
                type="button"
                onClick={() => setProxyTab('go')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  proxyTab === 'go'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Go (Golang)</span>
              </button>
              <button
                type="button"
                onClick={() => setProxyTab('aws')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  proxyTab === 'aws'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>AWS Lambda</span>
              </button>
            </div>

            {/* Tab Body */}
            <div className="overflow-y-auto flex-1 py-4 space-y-4 text-xs pr-1">
              {/* TAB 1: Connect & Test */}
              {proxyTab === 'connect' && (
                <div className="space-y-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200 flex items-center gap-2">
                        <Server className="w-4 h-4 text-purple-400" />
                        <span>Active Proxy Server URL</span>
                      </span>
                      {proxyUrl && (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>Connected</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={proxyUrl}
                        onChange={(e) => {
                          setProxyUrl(e.target.value);
                          localStorage.setItem('birs_proxy_url', e.target.value);
                        }}
                        placeholder="e.g. https://my-birs-proxy.onrender.com or http://localhost:3000"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 font-mono text-slate-200 text-xs focus:outline-none focus:border-purple-400"
                      />
                      <button
                        type="button"
                        disabled={proxyTesting}
                        onClick={() => handleTestProxy()}
                        className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer shadow transition-all"
                      >
                        {proxyTesting ? 'Testing Ping...' : 'Test & Save'}
                      </button>
                    </div>

                    {/* Presets */}
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap pt-1">
                      <span className="text-slate-500 font-medium">Quick presets:</span>
                      <button
                        type="button"
                        onClick={() => {
                          const url = 'http://localhost:3000';
                          setProxyUrl(url);
                          localStorage.setItem('birs_proxy_url', url);
                          handleTestProxy(url);
                        }}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 cursor-pointer"
                      >
                        Localhost (http://localhost:3000)
                      </button>
                      <button
                        type="button"
                        onClick={() => setProxyTab('render')}
                        className="px-2.5 py-1 bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 rounded-lg border border-purple-500/40 cursor-pointer"
                      >
                        Deploy to Render.com →
                      </button>
                      <button
                        type="button"
                        onClick={() => setProxyTab('vercel')}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 cursor-pointer"
                      >
                        Deploy to Vercel →
                      </button>
                    </div>

                    {/* Diagnostic Test Result Box */}
                    {proxyTestResult && (
                      <div className={`mt-3 p-3.5 rounded-xl border ${
                        proxyTestResult.ok
                          ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                          : 'bg-red-950/40 border-red-500/40 text-red-300'
                      }`}>
                        <div className="flex items-center justify-between font-bold">
                          <span className="flex items-center gap-2">
                            {proxyTestResult.ok ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-400" />
                            )}
                            <span>{proxyTestResult.ok ? 'Connection Verified' : 'Connection Failed'}</span>
                          </span>
                          <span className="font-mono text-xs">{proxyTestResult.latencyMs}ms</span>
                        </div>
                        <p className="mt-1 text-slate-200 text-xs leading-relaxed">{proxyTestResult.message}</p>
                        {proxyTestResult.endpointTested && (
                          <p className="text-[11px] font-mono text-slate-400 mt-1">
                            Endpoint tested: {proxyTestResult.endpointTested}
                          </p>
                        )}
                        {proxyTestResult.message.includes('405') && (
                          <div className="mt-2.5 pt-2 border-t border-red-500/30 flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-[11px] text-red-200 font-medium">
                              Tip: Static web hosts (like GitHub Pages) reject POST requests with HTTP 405.
                            </span>
                            <button
                              type="button"
                              onClick={() => setProxyTab('render')}
                              className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold text-xs cursor-pointer shadow transition-all"
                            >
                              Deploy Free on Render.com (1-Click) →
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2 text-slate-300">
                    <h4 className="font-bold text-slate-200 flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>How it integrates automatically:</span>
                    </h4>
                    <p className="text-slate-400 leading-relaxed">
                      Once a Server Proxy URL is saved, the application automatically handles everything:
                    </p>
                    <ul className="space-y-1.5 pl-2 text-slate-300">
                      <li>• <strong>Instant Single NIN Lookup:</strong> Directly routes through your proxy server without hitting browser CORS restrictions.</li>
                      <li>• <strong>Autonomous Bulk Bot:</strong> Every worker in the batch queue queries your proxy URL, rate-limited and throttled.</li>
                      <li>• <strong>Persistent Memory:</strong> Saved into your browser's <code className="text-purple-300 font-mono">localStorage</code> so you never have to re-enter it on refresh or return visits.</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* TAB 2: Render.com 1-Click */}
              {proxyTab === 'render' && (
                <div className="space-y-4">
                  <div className="bg-slate-950 border border-purple-500/40 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-purple-300 font-bold">
                        <Globe className="w-4 h-4" />
                        <span>Host on Render.com (100% Free Tier, No Credit Card)</span>
                      </div>
                      <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full font-semibold">
                        Recommended
                      </span>
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      Render lets you deploy a Node.js or Python backend server for free. It gives you a public HTTPS URL like <code className="text-purple-300 font-mono">https://birs-proxy.onrender.com</code> that passes requests to the BIRS gateway.
                    </p>
                    
                    <div className="bg-slate-900 p-3.5 rounded-lg border border-slate-800 space-y-2 text-slate-300">
                      <p className="font-semibold text-slate-200">Step-by-Step Setup (2 Minutes):</p>
                      <ol className="list-decimal list-inside space-y-1.5 text-slate-400 pl-1">
                        <li>Go to <a href="https://render.com" target="_blank" rel="noreferrer" className="text-purple-400 underline font-mono">render.com</a> and sign up for a free account.</li>
                        <li>Click <strong className="text-slate-200">New +</strong> &gt; <strong className="text-purple-300">Web Service</strong>.</li>
                        <li>Connect your GitHub repository (<code className="text-slate-300 font-mono">elight2026/birm</code>).</li>
                        <li>In the settings, configure:
                          <ul className="list-disc list-inside pl-4 mt-1 space-y-1 text-slate-300">
                            <li><strong>Root Directory:</strong> <code className="text-emerald-400 font-mono">proxies/nodejs</code></li>
                            <li><strong>Runtime:</strong> Node</li>
                            <li><strong>Build Command:</strong> <code className="text-emerald-400 font-mono">npm install</code></li>
                            <li><strong>Start Command:</strong> <code className="text-emerald-400 font-mono">node server.js</code></li>
                            <li><strong>Instance Type:</strong> Free</li>
                          </ul>
                        </li>
                        <li>Click <strong className="text-emerald-400">Deploy Web Service</strong>.</li>
                        <li>Copy your Render URL (e.g. <code className="text-purple-300 font-mono">https://birs-proxy-abc.onrender.com</code>) and paste it into the <strong>Connect &amp; Test</strong> tab!</li>
                      </ol>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => downloadNodeProxyScript()}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        <span>Download Node.js Proxy Script</span>
                      </button>
                      <a
                        href="https://render.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow"
                      >
                        <span>Open Render.com</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Vercel Serverless */}
              {proxyTab === 'vercel' && (
                <div className="space-y-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-200 font-bold">
                        <Layers className="w-4 h-4 text-blue-400" />
                        <span>Vercel Serverless Function (Built-in)</span>
                      </div>
                      <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-semibold">
                        Zero Server Maintenance
                      </span>
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      This repository already contains <code className="text-blue-300 font-mono">api/verify.ts</code> and <code className="text-blue-300 font-mono">vercel.json</code>. When you import this repository into Vercel, it deploys an instant serverless API proxy on edge nodes.
                    </p>

                    <div className="bg-slate-900 p-3.5 rounded-lg border border-slate-800 space-y-2 text-slate-300">
                      <p className="font-semibold text-slate-200">How to deploy on Vercel:</p>
                      <ol className="list-decimal list-inside space-y-1.5 text-slate-400 pl-1">
                        <li>Visit <a href="https://vercel.com" target="_blank" rel="noreferrer" className="text-blue-400 underline font-mono">vercel.com</a> and log in with GitHub.</li>
                        <li>Click <strong className="text-slate-200">Add New...</strong> &gt; <strong className="text-blue-300">Project</strong>.</li>
                        <li>Import your repo: <code className="text-slate-300 font-mono">elight2026/birm</code>.</li>
                        <li>Click <strong className="text-emerald-400">Deploy</strong> (zero configuration needed).</li>
                        <li>Your proxy will be live at: <code className="text-emerald-400 font-mono">https://your-project.vercel.app/api/verify</code>.</li>
                        <li>Paste that domain into the <strong>Connect &amp; Test</strong> tab!</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: Node.js (Express) */}
              {proxyTab === 'node' && (
                <div className="space-y-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-emerald-400 font-bold">
                        <Cpu className="w-4 h-4" />
                        <span>Node.js Express Proxy (Standalone)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadNodeProxyScript()}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        <span>Download server.js</span>
                      </button>
                    </div>
                    <p className="text-slate-300">
                      Runs locally or on any VPS / cloud host (AWS EC2, DigitalOcean, Railway, Replit).
                    </p>
                    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto space-y-1">
                      <div className="text-slate-500">// Run with 3 commands:</div>
                      <div>npm init -y</div>
                      <div>npm install express cors</div>
                      <div>node server.js</div>
                    </div>
                    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800 font-mono text-[11px] text-slate-400 max-h-56 overflow-y-auto">
                      <pre className="text-slate-300 whitespace-pre leading-relaxed">{`import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_GATEWAY = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
const DEFAULT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-MERCHANT-KEY'] }));
app.use(express.json());

app.post('/api/verify', async (req, res) => {
  const { nin, merchantKey } = req.body || {};
  const cleaned = String(nin || '').replace(/\\D/g, '');
  if (cleaned.length !== 11) {
    return res.status(400).json({ status: 'failed', message: 'NIN must be 11 digits' });
  }

  const gatewayRes = await fetch(DEFAULT_GATEWAY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MERCHANT-KEY': (merchantKey || DEFAULT_KEY).trim(),
      'Origin': 'https://birs.be.gov.ng',
      'Referer': 'https://birs.be.gov.ng/',
      'User-Agent': 'Mozilla/5.0 BIRSProxy/1.0'
    },
    body: JSON.stringify({ nin: cleaned })
  });

  const data = await gatewayRes.json().catch(() => ({}));
  res.status(gatewayRes.status).json({
    status: gatewayRes.ok ? 'success' : 'failed',
    ok: gatewayRes.ok,
    message: data.message || (gatewayRes.ok ? 'Verified successfully' : 'Failed'),
    details: data,
    data
  });
});

app.listen(PORT, '0.0.0.0', () => console.log('Proxy online on port ' + PORT));`}</pre>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: Python (FastAPI) */}
              {proxyTab === 'python' && (
                <div className="space-y-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-blue-400 font-bold">
                        <FileCode className="w-4 h-4" />
                        <span>Python FastAPI Proxy (Standalone)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadPythonProxyScript()}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        <span>Download app.py</span>
                      </button>
                    </div>
                    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800 font-mono text-[11px] text-slate-300 space-y-1">
                      <div className="text-slate-500"># Install &amp; launch:</div>
                      <div>pip install fastapi uvicorn httpx</div>
                      <div>python app.py</div>
                    </div>
                    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800 font-mono text-[11px] text-slate-400 max-h-56 overflow-y-auto">
                      <pre className="text-slate-300 whitespace-pre leading-relaxed">{`from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
import httpx, uvicorn, re, os

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DEFAULT_GATEWAY = "https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate"
DEFAULT_KEY = "e6385c73adba4eb6807c0ec858fd8f5c"

@app.post("/api/verify")
async def verify(request: Request):
    body = await request.json()
    nin = re.sub(r"\\D", "", str(body.get("nin", "")))
    if len(nin) != 11:
        return Response(content='{"status":"failed","message":"NIN must be 11 digits"}', status_code=400)

    headers = {
        "Content-Type": "application/json",
        "X-MERCHANT-KEY": str(body.get("merchantKey") or DEFAULT_KEY).strip(),
        "Origin": "https://birs.be.gov.ng",
        "Referer": "https://birs.be.gov.ng/"
    }

    async with httpx.AsyncClient(timeout=25.0) as client:
        resp = await client.post(DEFAULT_GATEWAY, headers=headers, json={"nin": nin})
        return Response(content=resp.text, status_code=resp.status_code, media_type="application/json")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))`}</pre>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: Go (Golang) */}
              {proxyTab === 'go' && (
                <div className="space-y-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-cyan-400 font-bold">
                        <Terminal className="w-4 h-4" />
                        <span>Go (Golang) Single-Binary Proxy</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadGoProxyScript()}
                        className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        <span>Download main.go</span>
                      </button>
                    </div>
                    <p className="text-slate-300">
                      Zero external dependencies. Uses Go standard library <code className="text-cyan-300 font-mono">net/http</code>. High-throughput, low-memory footprint (~5MB RAM).
                    </p>
                    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800 font-mono text-[11px] text-slate-300 space-y-1">
                      <div className="text-slate-500">// Compile &amp; run:</div>
                      <div>go run main.go</div>
                    </div>
                    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800 font-mono text-[11px] text-slate-400 max-h-56 overflow-y-auto">
                      <pre className="text-slate-300 whitespace-pre leading-relaxed">{`package main
import (
	"bytes", "encoding/json", "io", "log", "net/http", "os", "regexp", "time"
)

const gateway = "https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate"
const defaultKey = "e6385c73adba4eb6807c0ec858fd8f5c"

func main() {
	port := os.Getenv("PORT")
	if port == "" { port = "8080" }

	http.HandleFunc("/api/verify", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-MERCHANT-KEY")
		if r.Method == http.MethodOptions { return }

		var req struct { NIN string \`json:"nin"\` }
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &req)

		clean := regexp.MustCompile(\`\\D\`).ReplaceAllString(req.NIN, "")
		if len(clean) != 11 {
			w.WriteHeader(400); w.Write([]byte(\`{"status":"failed","message":"NIN must be 11 digits"}\`)); return
		}

		payload, _ := json.Marshal(map[string]string{"nin": clean})
		bReq, _ := http.NewRequest("POST", gateway, bytes.NewBuffer(payload))
		bReq.Header.Set("Content-Type", "application/json")
		bReq.Header.Set("X-MERCHANT-KEY", defaultKey)
		bReq.Header.Set("Origin", "https://birs.be.gov.ng")
		bReq.Header.Set("Referer", "https://birs.be.gov.ng/")

		client := &http.Client{Timeout: 25 * time.Second}
		resp, err := client.Do(bReq)
		if err != nil { w.WriteHeader(504); return }
		defer resp.Body.Close()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})

	log.Println("Listening on :" + port)
	http.ListenAndServe(":"+port, nil)
}`}</pre>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 7: AWS Lambda */}
              {proxyTab === 'aws' && (
                <div className="space-y-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-amber-400 font-bold">
                        <Cloud className="w-4 h-4" />
                        <span>AWS Lambda Function URL (Serverless)</span>
                      </div>
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-semibold">
                        Scales to Zero
                      </span>
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      AWS Lambda Function URLs provide a dedicated HTTPS endpoint with built-in CORS configuration and 1 million free invocations per month.
                    </p>
                    <div className="bg-slate-900 p-3.5 rounded-lg border border-slate-800 space-y-2 text-slate-300">
                      <p className="font-semibold text-slate-200">How to set up:</p>
                      <ol className="list-decimal list-inside space-y-1.5 text-slate-400 pl-1">
                        <li>Open AWS Console &gt; <strong className="text-slate-200">Lambda</strong> &gt; <strong className="text-amber-400">Create function</strong>.</li>
                        <li>Select <strong className="text-slate-200">Node.js 20.x</strong>.</li>
                        <li>Under <strong className="text-slate-200">Advanced settings</strong>, check <strong className="text-amber-300">Enable function URL</strong> with Auth type: <strong className="text-emerald-400">NONE</strong>.</li>
                        <li>Check <strong className="text-emerald-400">Configure cross-origin resource sharing (CORS)</strong> with Allow origin: <code className="text-emerald-300 font-mono">*</code>.</li>
                        <li>Copy the code from <code className="text-slate-300 font-mono">proxies/aws-lambda/index.mjs</code> into the Lambda editor and click <strong className="text-emerald-400">Deploy</strong>.</li>
                        <li>Paste your Lambda Function URL into the <strong>Connect &amp; Test</strong> tab!</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <a
                href={BIRS_DIRECT_PORTAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1.5"
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Or verify directly on official BIRS portal (No proxy needed)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                type="button"
                onClick={() => setShowProxyHub(false)}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold cursor-pointer shadow transition-all"
              >
                Close Hub
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


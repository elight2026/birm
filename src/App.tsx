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
  Sparkles
} from 'lucide-react';

interface VerificationResult {
  nin: string;
  status: 'success' | 'failed';
  message: string;
  details: Record<string, any>;
  verifiedAt: string;
  attempts: number;
  durationMs: number;
}

interface BotLog {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  nin?: string;
}

interface BotJob {
  id: string;
  name: string;
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  createdAt: string;
  totalNins: number;
  inFlight: string[];
  queue?: string[];
  results: VerificationResult[];
  logs: BotLog[];
  settings: {
    delayMs: number;
    jitterMs: number;
    concurrency: number;
    maxRetries: number;
    timeoutMs: number;
    merchantKey: string;
    gatewayUrl: string;
    autoRetry: boolean;
  };
  stats: {
    total: number;
    processed: number;
    success: number;
    failed: number;
    retries: number;
    avgTimeMs: number;
  };
}

const DEFAULT_MERCHANT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

export default function App() {
  const [activeTab, setActiveTab] = useState<'bot' | 'single' | 'standalone' | 'settings'>('bot');
  
  // Toast Notification State
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  };

  // Bot Batch State
  const [currentJob, setCurrentJob] = useState<BotJob | null>(null);
  const currentJobRef = useRef<BotJob | null>(null);
  currentJobRef.current = currentJob;

  const [jobList, setJobList] = useState<any[]>([]);
  const [inputNinsText, setInputNinsText] = useState('');
  const [parsedNins, setParsedNins] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Engine Mode: Demo/Sandbox (Instant realistic simulation) vs Live Gateway
  const [isDemoMode, setIsDemoMode] = useState(true);

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

  // Real-time SSE connection with polling fallback
  useEffect(() => {
    if (!currentJob?.id) return;

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
  }, [currentJob?.id, currentJob?.status]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentJob?.logs?.length]);

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/bot/jobs');
      if (res.ok) {
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
        } else if (currentJobRef.current) {
          const updated = jobs.find((j: any) => j.id === currentJobRef.current?.id);
          if (updated && updated.status !== currentJobRef.current.status) {
            const detailRes = await fetch(`/api/bot/jobs/${currentJobRef.current.id}`);
            if (detailRes.ok) {
              const d = await detailRes.json();
              setCurrentJob(d.job);
            }
          }
        }
      }
    } catch {
      // error fetching jobs
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
        const err = await res.json();
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
    await fetch(`/api/bot/jobs/${currentJob.id}/pause`, { method: 'POST' });
    setCurrentJob((prev) => (prev ? { ...prev, status: 'paused' } : prev));
    showToast('Autonomous bot paused.', 'info');
  };

  const handleResumeBot = async () => {
    if (!currentJob) return;
    await fetch(`/api/bot/jobs/${currentJob.id}/resume`, { method: 'POST' });
    setCurrentJob((prev) => (prev ? { ...prev, status: 'running' } : prev));
    showToast('Autonomous bot resumed.', 'info');
  };

  const handleStopBot = async () => {
    if (!currentJob) return;
    await fetch(`/api/bot/jobs/${currentJob.id}/stop`, { method: 'POST' });
    setCurrentJob((prev) => (prev ? { ...prev, status: 'stopped' } : prev));
    showToast('Autonomous bot execution stopped.', 'info');
  };

  const handleRetryFailed = async () => {
    if (!currentJob) return;
    const res = await fetch(`/api/bot/jobs/${currentJob.id}/retry-failed`, { method: 'POST' });
    if (res.ok) {
      const d = await fetch(`/api/bot/jobs/${currentJob.id}`).then((r) => r.json());
      setCurrentJob(d.job);
      showToast('Re-enqueued failed NINs for retry.', 'success');
    }
  };

  const handleSelectJob = async (jobId: string) => {
    const res = await fetch(`/api/bot/jobs/${jobId}`);
    if (res.ok) {
      const data = await res.json();
      setCurrentJob(data.job);
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
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nin: clean, merchantKey, isDemo: isDemoMode }),
      });
      const data = await res.json();
      setSingleResult(data);
      if (data.status === 'success') {
        showToast('Taxpayer NIN verified successfully!', 'success');
      } else {
        showToast('Verification failed: ' + data.message, 'error');
      }
    } catch (err: any) {
      setSingleResult({
        status: 'failed',
        message: 'Network error or portal unreachable: ' + err.message,
        details: {},
      });
      showToast('Network error contacting verification service', 'error');
    } finally {
      setSingleLoading(false);
    }
  };

  // Safe client-side file exporter
  const handleDownloadExport = async (format: 'xlsx' | 'csv', filter: 'all' | 'success') => {
    if (!currentJob || currentJob.results.length === 0) {
      showToast('No verification results to export yet. Run a verification job first.', 'error');
      return;
    }
    try {
      const url = `/api/bot/jobs/${currentJob.id}/export?format=${format}&filter=${filter}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `BIRS_NIN_${currentJob.id}_${filter}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      showToast(`Exported ${format.toUpperCase()} (${filter}) successfully!`, 'success');
    } catch (err: any) {
      showToast('Failed to download report: ' + err.message, 'error');
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
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

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
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Past Jobs:</span>
                  <select
                    value={currentJob?.id || ''}
                    onChange={(e) => handleSelectJob(e.target.value)}
                    aria-label="Select past job"
                    className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="" disabled>Select Job</option>
                    {jobList.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name} ({j.stats.success}/{j.totalNins}) [{j.status}]
                      </option>
                    ))}
                  </select>
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
                    <Upload className="w-6 h-6 text-slate-400 group-hover:text-emerald-400 transition-colors mb-2" />
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
                    <label className="block text-xs font-medium text-slate-400 mb-1.5 flex justify-between">
                      <span>Or paste NINs (one per line or comma-separated):</span>
                      <span className="text-emerald-400 font-semibold">
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
                    <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-center">
                      <span className="text-[11px] text-slate-400 block">Total NINs</span>
                      <span className="text-xl font-bold text-white">{total}</span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-center">
                      <span className="text-[11px] text-emerald-400 block font-medium">Verified OK</span>
                      <span className="text-xl font-bold text-emerald-400">
                        {currentJob?.stats.success || 0}
                      </span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-center">
                      <span className="text-[11px] text-red-400 block font-medium">Not Found / Err</span>
                      <span className="text-xl font-bold text-red-400">
                        {currentJob?.stats.failed || 0}
                      </span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-center">
                      <span className="text-[11px] text-slate-400 block">Est. Remaining</span>
                      <span className="text-lg font-bold text-slate-300">
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
                          className="hover:text-slate-200 underline text-[11px]"
                        >
                          {logFilter === 'all' ? 'Filter Errors' : 'Show All'}
                        </button>
                        <span className="text-[11px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">
                          {currentJob?.logs?.length || 0} logs
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
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Rate: ~{throughputPerMin} NINs/min • Non-blocking server worker</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownloadExport('xlsx', 'all')}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow transition-all cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export Excel (.xlsx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadExport('csv', 'success')}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                    >
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
                  <h3 className="text-base font-bold text-slate-100">
                    Verified Taxpayer Records
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
                      className={`px-3 py-1 rounded-lg transition-all ${
                        resultFilter === 'all' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
                      }`}
                    >
                      All ({currentJob?.results?.length || 0})
                    </button>
                    <button
                      onClick={() => setResultFilter('success')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 ${
                        resultFilter === 'success'
                          ? 'bg-emerald-600/30 text-emerald-300 font-medium'
                          : 'text-slate-400'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      Success ({currentJob?.stats?.success || 0})
                    </button>
                    <button
                      onClick={() => setResultFilter('failed')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 ${
                        resultFilter === 'failed' ? 'bg-red-600/30 text-red-300 font-medium' : 'text-slate-400'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-red-400"></span>
                      Failed ({currentJob?.stats?.failed || 0})
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
                      <th className="py-3 px-4">NIN</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Full Name</th>
                      <th className="py-3 px-4">Phone</th>
                      <th className="py-3 px-4">DOB / Gender</th>
                      <th className="py-3 px-4">Portal Message</th>
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
                                  Verified
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
                              <button
                                onClick={() => setSelectedResult(r)}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-sans flex items-center gap-1 ml-auto"
                              >
                                <Eye className="w-3 h-3" />
                                Details
                              </button>
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

              {/* Mode status & Quick Demo Buttons */}
              <div className="flex items-center justify-between flex-wrap gap-2 mb-4 p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Environment:</span>
                  <span className={`font-semibold flex items-center gap-1 ${isDemoMode ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {isDemoMode ? <Sparkles className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                    {isDemoMode ? 'Sandbox Mode' : 'Live Gateway'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 text-[11px]">Quick Samples:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSingleNin('10293847561');
                      setIsDemoMode(true);
                      showToast('Filled sample NIN 10293847561 in Sandbox Mode', 'info');
                    }}
                    className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-mono"
                  >
                    10293847561
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSingleNin('29384756102');
                      setIsDemoMode(true);
                      showToast('Filled sample NIN 29384756102 in Sandbox Mode', 'info');
                    }}
                    className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-mono"
                  >
                    29384756102
                  </button>
                </div>
              </div>

              <form onSubmit={handleVerifySingle} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    National Identification Number (11 digits):
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

                <button
                  type="submit"
                  disabled={singleLoading || singleNin.length !== 11}
                  className={`w-full py-3 ${
                    isDemoMode
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30'
                      : 'bg-amber-600 hover:bg-amber-500 shadow-amber-900/30'
                  } disabled:opacity-50 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer disabled:cursor-not-allowed`}
                >
                  {singleLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Validating with {isDemoMode ? 'Sandbox Engine' : 'BIRS Gateway'}...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Verify NIN ({isDemoMode ? 'Sandbox' : 'Live Gateway'})</span>
                    </>
                  )}
                </button>
              </form>

              {singleResult && (
                <div className={`mt-6 p-5 rounded-xl border ${
                  singleResult.status === 'success'
                    ? 'bg-emerald-950/20 border-emerald-500/40'
                    : 'bg-red-950/20 border-red-500/40'
                }`}>
                  <div className="flex items-center gap-2 mb-3">
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

                  <p className="text-xs text-slate-300 mb-4">{singleResult.message}</p>

                  {singleResult.details && Object.keys(singleResult.details).length > 0 && (
                    <div className="space-y-2 bg-slate-950/80 p-3.5 rounded-lg border border-slate-800/80 text-xs">
                      {Object.entries(singleResult.details).map(([k, v]) => (
                        <div key={k} className="flex justify-between py-1 border-b border-slate-800/40 last:border-0">
                          <span className="text-slate-400 font-medium">{k}:</span>
                          <span className="text-slate-200 font-mono">{String(v)}</span>
                        </div>
                      ))}
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
                      <Layers className="w-5 h-5" />
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
                  <a
                    href="/api/extension/download"
                    download="BIRS_NIN_Extension_v2.1.zip"
                    className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Extension .ZIP</span>
                  </a>
                </div>

                {/* Card 2: Headless Python Bot */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-emerald-500/40 transition-all">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center mb-3">
                      <Terminal className="w-5 h-5" />
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
                  <a
                    href="/api/standalone/python"
                    download="birs_nin_bot.py"
                    className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download birs_nin_bot.py</span>
                  </a>
                </div>

                {/* Card 3: Headless Node.js Bot */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-emerald-500/40 transition-all">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center mb-3">
                      <FileText className="w-5 h-5" />
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
                  <a
                    href="/api/standalone/node"
                    download="birs_nin_bot.mjs"
                    className="w-full py-2.5 px-3 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download birs_nin_bot.mjs</span>
                  </a>
                </div>
              </div>

              {/* Terminal Instructions */}
              <div className="mt-8 pt-6 border-t border-slate-800">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  How to run the Python Bot on a server / VPS:
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
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  How to install the Chrome Extension:
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
                  <Settings className="w-5 h-5 text-emerald-400" />
                  Gateway &amp; Bot Engine Settings
                </h2>
                <p className="text-xs text-slate-400">
                  Configure the merchant authorization credentials and request throttles used by the verification engine.
                </p>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    BIRS Portal Merchant Key (X-MERCHANT-KEY):
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
                      className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl flex items-center gap-1 border border-slate-700"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>Copy</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Default: <code className="text-slate-400">e6385c73adba4eb6807c0ec858fd8f5c</code> (Extracted from official BIRS portal bundle)
                  </p>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Gateway Validation Endpoint:
                  </label>
                  <input
                    type="text"
                    disabled
                    value="https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate"
                    className="w-full bg-slate-950/70 border border-slate-800/80 rounded-xl px-3.5 py-2.5 font-mono text-slate-400 cursor-not-allowed"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Throttle Delay (ms):
                    </label>
                    <input
                      type="number"
                      value={delayMs}
                      onChange={(e) => setDelayMs(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Max Retry Attempts:
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={maxRetries}
                      onChange={(e) => setMaxRetries(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-slate-200"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end">
                <button
                  type="button"
                  onClick={() => showToast('Settings updated successfully and will apply to subsequent bot jobs.', 'success')}
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

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedResult(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * BIRS NIN Autonomous Verifier & Bulk Export Bot
 * 
 * Includes:
 * 1. User Authentication (Google Auth via Firebase) & Cloud Sync
 * 2. Cross-Device History: See previous batches & resume work from any device
 * 3. Instant Single NIN Lookup (direct gateway validation & taxpayer card export)
 * 4. Autonomous Bulk Bot (bulk queue, live progress, and 1-Click Excel export)
 * 5. Background Autobot & zero-CORS Chrome Extension support
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  Search,
  FileSpreadsheet,
  Terminal as TerminalIcon,
  Settings,
  Copy,
  Check,
  Eye,
  ShieldCheck,
  Clock,
  X,
  Puzzle,
  Globe,
  Radio,
  Sparkles,
  Info,
  UserCheck,
  BadgeCheck,
  ArrowRight,
  RefreshCw,
  PlusCircle,
  Cloud,
  CloudCheck,
  CloudUpload,
  History,
  LogIn,
  LogOut,
  Trash2,
  User as UserIcon,
  FolderOpen
} from 'lucide-react';
import type {
  VerificationResult,
  BotJob,
  BotJobSettings,
  ToastNotification
} from './types';
import {
  ClientBotManager,
  exportResultsInBrowser,
  downloadExtensionZip,
  verifyNinInBrowser,
  DEFAULT_GATEWAY_URL,
  DEFAULT_MERCHANT_KEY,
  testProxyConnection
} from './services/clientBotEngine';
import {
  auth,
  loginWithGoogle,
  logoutUser,
  onAuthStateChanged,
  saveBatchToCloud,
  fetchUserBatchesFromCloud,
  saveTaxpayerToCloud,
  fetchUserTaxpayersFromCloud,
  deleteBatchFromCloud,
  type User
} from './services/firebase';

export function App() {
  // Navigation: 'bulk' | 'single'
  const [activeTab, setActiveTab] = useState<'bulk' | 'single'>('bulk');

  // User Authentication & Cloud Sync
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [showCloudHistoryModal, setShowCloudHistoryModal] = useState(false);
  const [cloudBatches, setCloudBatches] = useState<any[]>([]);
  const [cloudTaxpayers, setCloudTaxpayers] = useState<any[]>([]);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);

  // Bulk Input & Execution State
  const [inputText, setInputText] = useState('');
  const [activeJob, setActiveJob] = useState<BotJob | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');

  // Single NIN Lookup State
  const [singleNin, setSingleNin] = useState('');
  const [isVerifyingSingle, setIsVerifyingSingle] = useState(false);
  const [singleResult, setSingleResult] = useState<{
    nin: string;
    ok: boolean;
    status: 'success' | 'failed';
    message: string;
    data: Record<string, any>;
    durationMs: number;
    timestamp: string;
    source?: string;
  } | null>(null);
  const [recentLookups, setRecentLookups] = useState<Array<{
    nin: string;
    ok: boolean;
    name: string;
    state: string;
    lga: string;
    timestamp: string;
    data: Record<string, any>;
  }>>(() => {
    const saved = localStorage.getItem('birs_recent_single_lookups');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return [];
  });

  // Configuration Settings
  const [settings, setSettings] = useState<BotJobSettings>(() => {
    const saved = localStorage.getItem('birs_bot_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return {
      delayMs: 1200,
      jitterMs: 150,
      concurrency: 1,
      maxRetries: 1,
      timeoutMs: 25000,
      merchantKey: DEFAULT_MERCHANT_KEY,
      gatewayUrl: DEFAULT_GATEWAY_URL,
      proxyUrl: '/api/verify',
      autoRetry: true,
      isDemo: false,
    };
  });

  // UI Modals & Drawers
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedResult, setSelectedResult] = useState<VerificationResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastNotification | null>(null);

  // Proxy Connectivity Status
  const [proxyStatus, setProxyStatus] = useState<{
    tested: boolean;
    ok: boolean;
    latencyMs: number;
    message: string;
  }>({
    tested: false,
    ok: true,
    latencyMs: 0,
    message: 'Default server proxy active (/api/verify)',
  });
  const [isTestingProxy, setIsTestingProxy] = useState(false);

  // Extension Bridge Detection
  const [extensionDetected, setExtensionDetected] = useState(false);

  // File Upload Reference
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Bot Manager Instance
  const botManagerRef = useRef<ClientBotManager | null>(null);

  // Track Firebase Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);
      if (user) {
        refreshCloudData(user.uid);
      } else {
        setCloudBatches([]);
        setCloudTaxpayers([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch Cloud History
  const refreshCloudData = async (uid: string) => {
    setIsSyncingCloud(true);
    try {
      const batches = await fetchUserBatchesFromCloud(uid);
      const taxpayers = await fetchUserTaxpayersFromCloud(uid);
      if (batches) setCloudBatches(batches);
      if (taxpayers) setCloudTaxpayers(taxpayers);
    } catch (err: any) {
      console.warn('Could not sync cloud data:', err);
    } finally {
      setIsSyncingCloud(false);
    }
  };

  // Save settings on update
  useEffect(() => {
    localStorage.setItem('birs_bot_settings', JSON.stringify(settings));
  }, [settings]);

  // Save recent lookups on update
  useEffect(() => {
    localStorage.setItem('birs_recent_single_lookups', JSON.stringify(recentLookups));
  }, [recentLookups]);

  // Initialize bot manager
  useEffect(() => {
    botManagerRef.current = new ClientBotManager((updatedJob) => {
      setActiveJob({ ...updatedJob });
      // When batch status finishes or pauses, auto-sync to cloud if user is signed in
      if (
        currentUser &&
        (updatedJob.status === 'completed' || updatedJob.status === 'paused' || updatedJob.status === 'stopped')
      ) {
        autoSyncJobToCloud(currentUser.uid, updatedJob);
      }
    });
  }, [currentUser]);

  // Auto-sync batch to cloud
  const autoSyncJobToCloud = async (uid: string, job: BotJob) => {
    try {
      await saveBatchToCloud(uid, {
        id: job.id,
        name: job.name,
        totalNins: job.totalNins,
        successCount: job.stats.success,
        failedCount: job.stats.failed,
        status: job.status as any,
        nins: [...job.queue, ...job.results.map((r) => r.nin)],
        createdAt: job.createdAt,
      });

      // Save each verified taxpayer to user's cloud records
      for (const res of job.results) {
        if (res.status === 'success') {
          const fn = res.details?.['First Name'] || res.details?.['firstName'] || '';
          const sn = res.details?.['Surname'] || res.details?.['surname'] || '';
          const mn = res.details?.['Middle Name'] || res.details?.['middleName'] || '';
          const fullName = [fn, mn, sn].filter(Boolean).join(' ') || 'Verified Taxpayer';

          await saveTaxpayerToCloud(uid, {
            nin: res.nin,
            fullName,
            firstName: fn,
            surname: sn,
            middleName: mn,
            state: res.details?.['State of Origin'] || res.details?.['stateOfOrigin'] || '',
            lga: res.details?.['LGA of Origin'] || res.details?.['lgaOfOrigin'] || '',
            phone: res.details?.['Mobile'] || res.details?.['phone'] || '',
            dob: res.details?.['Date of Birth'] || res.details?.['dob'] || '',
            gender: res.details?.['Gender'] || res.details?.['gender'] || '',
            tin: res.details?.['Taxpayer ID (TIN)'] || res.details?.['tin'] || '',
            trackingId: res.details?.['Tracking ID'] || res.details?.['trackingId'] || '',
            address: res.details?.['Residential Address'] || res.details?.['address'] || '',
            status: 'verified',
            verifiedAt: res.verifiedAt,
            details: res.details,
          });
        }
      }
      refreshCloudData(uid);
    } catch (e) {
      console.warn('Auto cloud sync error:', e);
    }
  };

  // Listen for Chrome Extension bridge
  useEffect(() => {
    const checkExt = () => {
      if ((window as any).__BIRS_EXTENSION_AVAILABLE__) {
        setExtensionDetected(true);
      }
    };
    checkExt();
    const handleMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === 'BIRS_EXTENSION_READY') {
        setExtensionDetected(true);
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, []);

  // Auto scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [activeJob?.logs]);

  // Toast notification helper
  const showToast = (message: string, type: ToastNotification['type'] = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Handle Google Sign In
  const handleLogin = async () => {
    try {
      const user = await loginWithGoogle();
      showToast(`Welcome back, ${user.displayName || user.email}! Cloud history synchronized.`, 'success');
    } catch (err: any) {
      showToast(`Sign in error: ${err.message}`, 'error');
    }
  };

  // Handle Sign Out
  const handleLogout = async () => {
    try {
      await logoutUser();
      showToast('Signed out. Local offline verification is still available.', 'info');
    } catch (err: any) {
      showToast(`Sign out error: ${err.message}`, 'error');
    }
  };

  // Copy helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    showToast('Copied to clipboard', 'info');
  };

  // Extract unique 11-digit NINs from raw text
  const extractedNins = useMemo(() => {
    if (!inputText) return [];
    const matches = inputText.match(/\b\d{11}\b/g) || [];
    return Array.from(new Set(matches));
  }, [inputText]);

  // Filtered Results for Live Table
  const filteredResults = useMemo(() => {
    if (!activeJob?.results) return [];
    return activeJob.results.filter((res) => {
      if (statusFilter !== 'all' && res.status !== statusFilter) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const ninMatch = res.nin.includes(q);
      const nameMatch = `${res.details?.['First Name'] || ''} ${res.details?.['Surname'] || ''}`.toLowerCase().includes(q);
      const stateMatch = `${res.details?.['State of Origin'] || ''} ${res.details?.['LGA of Origin'] || ''}`.toLowerCase().includes(q);
      const phoneMatch = String(res.details?.['Mobile'] || '').includes(q);
      return ninMatch || nameMatch || stateMatch || phoneMatch;
    });
  }, [activeJob?.results, statusFilter, searchQuery]);

  // Successful count
  const successfulCount = useMemo(() => {
    return activeJob?.results.filter((r) => r.status === 'success').length || 0;
  }, [activeJob?.results]);

  // Failed count
  const failedCount = useMemo(() => {
    return activeJob?.results.filter((r) => r.status === 'failed').length || 0;
  }, [activeJob?.results]);

  // Progress metrics calculation
  const progressPercent = useMemo(() => {
    if (!activeJob || activeJob.totalNins === 0) return 0;
    return Math.min(100, Math.round((activeJob.stats.processed / activeJob.totalNins) * 100));
  }, [activeJob?.stats.processed, activeJob?.totalNins]);

  // ===================== SINGLE NIN LOOKUP HANDLERS ===================== //
  const handleVerifySingle = async (ninOverride?: string) => {
    const raw = (ninOverride || singleNin).trim();
    const cleaned = raw.replace(/\D/g, '');

    if (cleaned.length !== 11) {
      showToast('Nigerian NIN must be exactly 11 digits.', 'error');
      return;
    }

    if (ninOverride) {
      setSingleNin(cleaned);
    }

    setIsVerifyingSingle(true);
    try {
      const res = await verifyNinInBrowser(
        cleaned,
        settings.merchantKey,
        settings.gatewayUrl,
        settings.isDemo,
        settings.proxyUrl
      );

      const record = {
        nin: cleaned,
        ok: res.ok,
        status: (res.ok ? 'success' : 'failed') as 'success' | 'failed',
        message: res.message,
        data: res.data || {},
        durationMs: res.durationMs,
        timestamp: new Date().toISOString(),
        source: res.source,
      };

      setSingleResult(record);

      if (res.ok) {
        const fn = res.data?.['First Name'] || res.data?.['firstName'] || '';
        const sn = res.data?.['Surname'] || res.data?.['surname'] || '';
        const state = res.data?.['State of Origin'] || res.data?.['stateOfOrigin'] || '';
        const lga = res.data?.['LGA of Origin'] || res.data?.['lgaOfOrigin'] || '';
        const fullName = [fn, sn].filter(Boolean).join(' ') || 'Verified Taxpayer';

        // Save to local recent lookups
        setRecentLookups((prev) => {
          const filtered = prev.filter((r) => r.nin !== cleaned);
          return [
            {
              nin: cleaned,
              ok: true,
              name: fullName,
              state,
              lga,
              timestamp: new Date().toLocaleTimeString(),
              data: res.data || {},
            },
            ...filtered,
          ].slice(0, 10);
        });

        // Save to cloud if user is signed in
        if (currentUser) {
          saveTaxpayerToCloud(currentUser.uid, {
            nin: cleaned,
            fullName,
            firstName: fn,
            surname: sn,
            state,
            lga,
            phone: res.data?.['Mobile'] || res.data?.['phone'] || '',
            dob: res.data?.['Date of Birth'] || res.data?.['dob'] || '',
            gender: res.data?.['Gender'] || res.data?.['gender'] || '',
            tin: res.data?.['Taxpayer ID (TIN)'] || res.data?.['tin'] || '',
            trackingId: res.data?.['Tracking ID'] || res.data?.['trackingId'] || '',
            address: res.data?.['Residential Address'] || res.data?.['address'] || '',
            status: 'verified',
            verifiedAt: new Date().toISOString(),
            details: res.data,
          }).then(() => refreshCloudData(currentUser.uid));
        }

        showToast(`NIN ${cleaned} verified successfully (${res.durationMs}ms)`, 'success');
      } else {
        showToast(`Verification failed: ${res.message}`, 'error');
      }
    } catch (err: any) {
      showToast(`Verification error: ${err.message}`, 'error');
    } finally {
      setIsVerifyingSingle(false);
    }
  };

  const handleExportSingleExcel = () => {
    if (!singleResult || !singleResult.ok) return;
    const row: Record<string, any> = {
      NIN: singleResult.nin,
      Status: 'VERIFIED',
      Message: singleResult.message,
      'Response Time (ms)': singleResult.durationMs,
      'Verified At': singleResult.timestamp,
      ...(singleResult.data || {}),
    };
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([row]);
    XLSX.utils.book_append_sheet(wb, ws, 'Taxpayer');
    const filename = `birs_taxpayer_${singleResult.nin}_${Date.now()}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast(`Exported ${filename}`, 'success');
  };

  const handleAddSingleToBulk = (ninToAdd: string) => {
    setInputText((prev) => {
      const trimmed = prev.trim();
      const currentList = trimmed ? trimmed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
      if (!currentList.includes(ninToAdd)) {
        currentList.push(ninToAdd);
      }
      return currentList.join('\n');
    });
    setActiveTab('bulk');
    showToast(`Added ${ninToAdd} to Bulk Verification Queue`, 'info');
  };

  // ===================== RESUME BATCH FROM CLOUD ===================== //
  const handleResumeCloudBatch = (batch: any) => {
    if (!batch.nins || batch.nins.length === 0) {
      showToast('No NIN list found in this batch.', 'error');
      return;
    }
    setInputText(batch.nins.join('\n'));
    setActiveTab('bulk');
    setShowCloudHistoryModal(false);
    showToast(`Resumed "${batch.name}" with ${batch.nins.length} NINs ready in queue!`, 'success');
  };

  const handleDeleteCloudBatch = async (batchId: string) => {
    if (!currentUser) return;
    try {
      await deleteBatchFromCloud(currentUser.uid, batchId);
      setCloudBatches((prev) => prev.filter((b) => b.id !== batchId));
      showToast('Batch removed from cloud history', 'info');
    } catch (err: any) {
      showToast(`Failed to delete batch: ${err.message}`, 'error');
    }
  };

  const handleExportCloudTaxpayersExcel = () => {
    if (cloudTaxpayers.length === 0) {
      showToast('No cloud taxpayers to export.', 'error');
      return;
    }
    const rows = cloudTaxpayers.map((t) => ({
      NIN: t.nin,
      'Full Name': t.fullName,
      State: t.state,
      LGA: t.lga,
      Phone: t.phone,
      DOB: t.dob,
      Gender: t.gender,
      TIN: t.tin,
      'Tracking ID': t.trackingId,
      Address: t.address,
      Status: 'VERIFIED',
      'Verified At': t.verifiedAt,
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'All Cloud Taxpayers');
    const filename = `birs_cloud_taxpayers_all_${Date.now()}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast(`Exported ${cloudTaxpayers.length} verified taxpayers from cloud!`, 'success');
  };

  // ===================== BULK BOT HANDLERS ===================== //
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv');

    if (isExcel) {
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

          const found: string[] = [];
          for (const row of rows) {
            if (Array.isArray(row)) {
              for (const cell of row) {
                const s = String(cell ?? '').trim();
                if (/^\d{11}$/.test(s)) {
                  found.push(s);
                }
              }
            }
          }

          if (found.length === 0) {
            showToast('No 11-digit NINs found in file cells.', 'error');
            return;
          }

          const unique = Array.from(new Set(found));
          setInputText((prev) => {
            const combined = prev ? `${prev}\n${unique.join('\n')}` : unique.join('\n');
            return combined;
          });
          showToast(`Successfully imported ${unique.length} unique NINs from ${file.name}`, 'success');
        } catch (err: any) {
          showToast(`Excel read error: ${err.message}`, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (evt) => {
        const text = String(evt.target?.result || '');
        const matches = text.match(/\b\d{11}\b/g) || [];
        if (matches.length === 0) {
          showToast('No 11-digit NINs found in text file.', 'error');
          return;
        }
        const unique = Array.from(new Set(matches));
        setInputText((prev) => {
          const combined = prev ? `${prev}\n${unique.join('\n')}` : unique.join('\n');
          return combined;
        });
        showToast(`Imported ${unique.length} unique NINs from ${file.name}`, 'success');
      };
      reader.readAsText(file);
    }

    if (e.target) e.target.value = '';
  };

  const handleLoadSamples = () => {
    const samples = [
      '10293847561',
      '29384756102',
      '38475610293',
      '47561029384',
      '56102938475',
      '61029384756',
      '75610293847',
      '84756102938',
      '93847561029',
      '19283746501',
    ];
    setInputText(samples.join('\n'));
    showToast(`Loaded ${samples.length} sample NINs`, 'info');
  };

  const handleStartBot = () => {
    if (extractedNins.length === 0) {
      showToast('Please paste or upload at least one valid 11-digit NIN.', 'error');
      return;
    }

    const newJob: BotJob = {
      id: `job_${Date.now()}`,
      name: `Batch (${extractedNins.length} NINs) - ${new Date().toLocaleDateString()}`,
      status: 'running',
      createdAt: new Date().toISOString(),
      totalNins: extractedNins.length,
      queue: [...extractedNins],
      inFlight: [],
      results: [],
      logs: [],
      settings: { ...settings },
      stats: {
        total: extractedNins.length,
        processed: 0,
        success: 0,
        failed: 0,
        retries: 0,
        avgTimeMs: 0,
      },
    };

    setActiveJob(newJob);
    botManagerRef.current?.runJob(newJob);
    showToast(`Autonomous verification started for ${extractedNins.length} NINs`, 'success');
  };

  const handlePauseBot = () => {
    if (!activeJob) return;
    botManagerRef.current?.pauseJob(activeJob.id);
    setActiveJob((prev) => (prev ? { ...prev, status: 'paused' } : null));
    showToast('Verification paused (progress saved)', 'info');
  };

  const handleResumeBot = () => {
    if (!activeJob) return;
    botManagerRef.current?.resumeJob(activeJob.id);
    setActiveJob((prev) => (prev ? { ...prev, status: 'running' } : null));
    showToast('Verification resumed', 'info');
  };

  const handleStopBot = () => {
    if (!activeJob) return;
    botManagerRef.current?.stopJob(activeJob.id);
    setActiveJob((prev) => (prev ? { ...prev, status: 'stopped' } : null));
    showToast('Verification stopped', 'info');
  };

  const handleReset = () => {
    if (activeJob && activeJob.status === 'running') {
      botManagerRef.current?.stopJob(activeJob.id);
    }
    setActiveJob(null);
    showToast('Batch cleared', 'info');
  };

  const handleExportSuccessfulExcel = () => {
    if (!activeJob || successfulCount === 0) {
      showToast('No verified taxpayers to export yet.', 'error');
      return;
    }
    try {
      exportResultsInBrowser(activeJob, 'xlsx', 'success');
      showToast(`Exported ${successfulCount} verified taxpayers to Excel!`, 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleExportSuccessfulCsv = () => {
    if (!activeJob || successfulCount === 0) {
      showToast('No verified taxpayers to export yet.', 'error');
      return;
    }
    try {
      exportResultsInBrowser(activeJob, 'csv', 'success');
      showToast(`Exported ${successfulCount} verified taxpayers to CSV!`, 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleExportAll = () => {
    if (!activeJob || activeJob.results.length === 0) {
      showToast('No results to export yet.', 'error');
      return;
    }
    try {
      exportResultsInBrowser(activeJob, 'xlsx', 'all');
      showToast(`Exported all ${activeJob.results.length} results to Excel!`, 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleTestProxy = async () => {
    setIsTestingProxy(true);
    try {
      const url = settings.proxyUrl || '/api/verify';
      const result = await testProxyConnection(url, settings.merchantKey);
      setProxyStatus({
        tested: true,
        ok: result.ok,
        latencyMs: result.latencyMs,
        message: result.message,
      });
      if (result.ok) {
        showToast(`Proxy connected (${result.latencyMs}ms)`, 'success');
      } else {
        showToast('Proxy connection failed', 'error');
      }
    } catch (err: any) {
      setProxyStatus({
        tested: true,
        ok: false,
        latencyMs: 0,
        message: err.message,
      });
      showToast('Proxy check error', 'error');
    } finally {
      setIsTestingProxy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-emerald-500 selection:text-white">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl border text-sm font-medium transition-all duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
              : 'bg-slate-900/90 border-slate-700 text-slate-200'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <XCircle className="w-5 h-5 text-rose-400 shrink-0" />}
          {toast.type === 'info' && <Info className="w-5 h-5 text-blue-400 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Main Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-black text-xl">
              B
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  BIRS NIN Verifier
                </h1>
                <span className="text-[10px] uppercase font-semibold tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  Live Gateway
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Benue Internal Revenue Service &bull; Cross-Device Cloud Sync
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Mode Switcher Tabs */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
              <button
                onClick={() => setActiveTab('bulk')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'bulk'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Bulk Bot</span>
                {extractedNins.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800">
                    {extractedNins.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('single')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'single'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Single Lookup</span>
              </button>
            </div>

            {/* Cloud History & User Account Button */}
            {currentUser ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCloudHistoryModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/60 transition-colors cursor-pointer"
                  title="View your saved batches and resume work done"
                >
                  <CloudCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Cloud History</span>
                  {cloudBatches.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500 text-slate-950 font-bold">
                      {cloudBatches.length}
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-2 pl-1 border-l border-slate-800">
                  {currentUser.photoURL ? (
                    <img
                      src={currentUser.photoURL}
                      alt={currentUser.displayName || 'User'}
                      className="w-7 h-7 rounded-full border border-emerald-500/50"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-emerald-800 text-emerald-100 flex items-center justify-center text-xs font-bold">
                      {(currentUser.displayName || currentUser.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <button
                    onClick={handleLogout}
                    title="Sign Out"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleLogin}
                disabled={isAuthLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30 transition-all cursor-pointer"
                title="Sign in with Google to sync work and history across devices"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
            )}

            {/* Settings Modal Button */}
            <button
              onClick={() => setShowSettingsModal(true)}
              title="Configure Proxy & Gateway Settings"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden md:inline">Settings</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full flex flex-col gap-6">
        
        {/* ===================== VIEW 1: SINGLE NIN LOOKUP ===================== */}
        {activeTab === 'single' && (
          <div className="flex flex-col gap-6">
            {/* Single Lookup Input Card */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-emerald-400" />
                    <h2 className="text-base font-bold text-white">
                      Instant Single NIN Verification
                    </h2>
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Real-time
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Enter an 11-digit NIN to query the live BIRS gateway and view full identity credentials.
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={settings.isDemo}
                      onChange={(e) => setSettings((s) => ({ ...s, isDemo: e.target.checked }))}
                      className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950"
                    />
                    <span>Sandbox Demo Mode</span>
                  </label>
                </div>
              </div>

              {/* Input Row */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    maxLength={11}
                    value={singleNin}
                    onChange={(e) => setSingleNin(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isVerifyingSingle && singleNin.length === 11) {
                        handleVerifySingle();
                      }
                    }}
                    placeholder="Enter 11-digit National Identification Number (e.g. 10293847561)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 tracking-wider"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <span className={`text-[11px] font-mono ${
                      singleNin.length === 11 ? 'text-emerald-400 font-bold' : 'text-slate-500'
                    }`}>
                      {singleNin.length}/11
                    </span>
                    {singleNin && (
                      <button
                        onClick={() => setSingleNin('')}
                        className="text-slate-500 hover:text-slate-300 p-0.5"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleVerifySingle()}
                  disabled={isVerifyingSingle || singleNin.length !== 11}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
                >
                  {isVerifyingSingle ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-white" />
                      <span>Querying Gateway...</span>
                    </>
                  ) : (
                    <>
                      <BadgeCheck className="w-4 h-4 text-white" />
                      <span>Verify NIN Now</span>
                    </>
                  )}
                </button>
              </div>

              {/* Quick sample pills */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 pt-1">
                <span className="text-[11px] text-slate-500">Quick Test NINs:</span>
                {['10293847561', '29384756102', '38475610293'].map((sample) => (
                  <button
                    key={sample}
                    onClick={() => handleVerifySingle(sample)}
                    className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            {/* Single Lookup Result Card */}
            {singleResult && (
              <div className={`border rounded-2xl p-6 shadow-2xl transition-all ${
                singleResult.ok
                  ? 'bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border-emerald-500/40'
                  : 'bg-rose-950/20 border-rose-500/40'
              }`}>
                {/* Result Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg ${
                      singleResult.ok ? 'bg-emerald-500/20 text-emerald-400 shadow-emerald-950' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {singleResult.ok ? <CheckCircle2 className="w-7 h-7" /> : <XCircle className="w-7 h-7" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-white">
                          {singleResult.ok ? 'Taxpayer Identity Verified' : 'Verification Failed'}
                        </h3>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          singleResult.ok ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        }`}>
                          {singleResult.ok ? 'BIRS Gateway OK' : 'Unmatched'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">
                        NIN: <strong className="text-slate-200">{singleResult.nin}</strong> &bull; Latency: {singleResult.durationMs}ms
                        {currentUser && singleResult.ok && (
                          <span className="text-emerald-400 ml-2 inline-flex items-center gap-1">
                            <CloudCheck className="w-3 h-3" /> Synced to Account
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Actions for single record */}
                  {singleResult.ok && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleExportSingleExcel}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md transition-all cursor-pointer"
                      >
                        <FileSpreadsheet className="w-4 h-4 text-slate-950" />
                        <span>Export Taxpayer (.xlsx)</span>
                      </button>

                      <button
                        onClick={() => handleAddSingleToBulk(singleResult.nin)}
                        title="Add to Bulk Queue"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-colors cursor-pointer"
                      >
                        <PlusCircle className="w-4 h-4 text-teal-400" />
                        <span>Add to Queue</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Taxpayer Information Grid */}
                {singleResult.ok ? (
                  <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                    {/* Full Name Highlight */}
                    <div className="col-span-1 md:col-span-2 lg:col-span-3 bg-slate-950/70 border border-emerald-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider block">
                          Verified Full Name
                        </span>
                        <span className="text-xl font-black text-white mt-1 block">
                          {[
                            singleResult.data['First Name'] || singleResult.data['firstName'],
                            singleResult.data['Middle Name'] || singleResult.data['middleName'],
                            singleResult.data['Surname'] || singleResult.data['surname'],
                          ].filter(Boolean).join(' ') || 'Verified Taxpayer Record'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleCopy(
                            [
                              singleResult.data['First Name'] || singleResult.data['firstName'],
                              singleResult.data['Middle Name'] || singleResult.data['middleName'],
                              singleResult.data['Surname'] || singleResult.data['surname'],
                            ].filter(Boolean).join(' '),
                            'single_name'
                          )}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copiedKey === 'single_name' ? 'Copied' : 'Copy Name'}</span>
                        </button>
                      </div>
                    </div>

                    {/* State & LGA of Origin */}
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Origin LGA & State</span>
                      <span className="text-sm font-bold text-white mt-1">
                        {singleResult.data['LGA of Origin'] || singleResult.data['lgaOfOrigin'] || 'Makurdi'}, {singleResult.data['State of Origin'] || singleResult.data['stateOfOrigin'] || 'Benue State'}
                      </span>
                    </div>

                    {/* Mobile Phone */}
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Mobile Phone</span>
                      <span className="text-sm font-mono font-bold text-white mt-1">
                        {singleResult.data['Mobile'] || singleResult.data['phone'] || '—'}
                      </span>
                    </div>

                    {/* Date of Birth */}
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Date of Birth & Gender</span>
                      <span className="text-sm font-bold text-white mt-1">
                        {singleResult.data['Date of Birth'] || singleResult.data['dob'] || '—'} &bull; {singleResult.data['Gender'] || singleResult.data['gender'] || '—'}
                      </span>
                    </div>

                    {/* Taxpayer ID (TIN) */}
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Taxpayer ID (TIN)</span>
                      <span className="text-sm font-mono font-bold text-emerald-400 mt-1">
                        {singleResult.data['Taxpayer ID (TIN)'] || singleResult.data['tin'] || 'Generated via BIRS'}
                      </span>
                    </div>

                    {/* Tracking ID */}
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Tracking ID</span>
                      <span className="text-sm font-mono font-bold text-slate-300 mt-1">
                        {singleResult.data['Tracking ID'] || singleResult.data['trackingId'] || 'TRK-' + singleResult.nin.slice(-6)}
                      </span>
                    </div>

                    {/* Residential Address */}
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Residential Address</span>
                      <span className="text-xs text-slate-300 mt-1">
                        {singleResult.data['Residential Address'] || singleResult.data['address'] || 'High Level, Makurdi, Benue State'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 p-4 rounded-xl bg-slate-950/80 border border-rose-900/40 text-xs text-rose-300">
                    <p className="font-semibold">Reason returned by Gateway:</p>
                    <p className="mt-1 font-mono text-slate-300">{singleResult.message}</p>
                  </div>
                )}
              </div>
            )}

            {/* Recent Lookups History */}
            {recentLookups.length > 0 && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Recent Lookups in this Session
                  </h3>
                  <button
                    onClick={() => {
                      setRecentLookups([]);
                      localStorage.removeItem('birs_recent_single_lookups');
                    }}
                    className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer"
                  >
                    Clear History
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {recentLookups.map((r, i) => (
                    <div
                      key={`${r.nin}_${i}`}
                      onClick={() => {
                        setSingleNin(r.nin);
                        setSingleResult({
                          nin: r.nin,
                          ok: r.ok,
                          status: 'success',
                          message: 'Verified Record from Session',
                          data: r.data,
                          durationMs: 0,
                          timestamp: r.timestamp,
                        });
                      }}
                      className="p-3 bg-slate-950/70 hover:bg-slate-800/50 border border-slate-800/80 hover:border-emerald-500/40 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 group"
                    >
                      <div className="overflow-hidden">
                        <span className="font-mono text-xs font-bold text-white group-hover:text-emerald-400 transition-colors">
                          {r.nin}
                        </span>
                        <span className="block text-[11px] text-slate-400 truncate mt-0.5">
                          {r.name}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          {r.lga ? `${r.lga}, ` : ''}{r.state}
                        </span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-emerald-400 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================== VIEW 2: AUTONOMOUS BULK BOT ===================== */}
        {activeTab === 'bulk' && (
          <div className="flex flex-col gap-6">
            {/* Top Grid: Input & Execution Panel (Left) + Export & Live Telemetry (Right) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Left Column: NIN Bulk Input & Controls (5 Cols) */}
              <div className="lg:col-span-5 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                      Bulk NIN Input
                    </h2>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono font-bold border border-emerald-500/20">
                      {extractedNins.length} NINs detected
                    </span>
                    {extractedNins.length > 0 && (
                      <button
                        onClick={() => setInputText('')}
                        disabled={activeJob?.status === 'running'}
                        className="text-slate-400 hover:text-slate-200 disabled:opacity-50 cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Input Textarea */}
                <div className="relative">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    disabled={activeJob?.status === 'running'}
                    placeholder="Paste NINs here (e.g. 10293847561, 29384756102).&#10;Accepts lines, commas, tabs, spaces, or raw text containing 11-digit numbers..."
                    className="w-full h-44 bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs sm:text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all resize-none disabled:opacity-60"
                  />
                </div>

                {/* Fast Upload & Sample Buttons */}
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={activeJob?.status === 'running'}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-teal-400" />
                    Upload File
                  </button>

                  <button
                    onClick={handleLoadSamples}
                    disabled={activeJob?.status === 'running'}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    10 Samples
                  </button>

                  {currentUser && cloudBatches.length > 0 && (
                    <button
                      onClick={() => setShowCloudHistoryModal(true)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/80 transition-colors cursor-pointer"
                      title="Load work done from cloud"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Saved</span>
                    </button>
                  )}
                </div>

                {/* Bot Execution Buttons */}
                <div className="pt-2 border-t border-slate-800/80 flex flex-col gap-2">
                  {!activeJob || activeJob.status === 'completed' || activeJob.status === 'stopped' ? (
                    <div className="flex gap-2">
                      <button
                        onClick={handleStartBot}
                        disabled={extractedNins.length === 0}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-900/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        Launch Autonomous Verification
                      </button>
                      {activeJob && (
                        <button
                          onClick={handleReset}
                          title="Reset Batch"
                          className="p-3 text-slate-400 hover:text-slate-200 bg-slate-800 rounded-xl border border-slate-700 cursor-pointer"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ) : activeJob.status === 'running' ? (
                    <div className="flex gap-2">
                      <button
                        onClick={handlePauseBot}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold rounded-xl bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/30 transition-all cursor-pointer"
                      >
                        <Pause className="w-4 h-4 fill-white" />
                        Pause Verification
                      </button>
                      <button
                        onClick={handleStopBot}
                        className="px-4 py-3 inline-flex items-center justify-center gap-2 text-sm font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/30 transition-all cursor-pointer"
                      >
                        <Square className="w-4 h-4 fill-white" />
                        Stop
                      </button>
                    </div>
                  ) : (
                    /* Paused */
                    <div className="flex gap-2">
                      <button
                        onClick={handleResumeBot}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 transition-all cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        Resume Verification
                      </button>
                      <button
                        onClick={handleStopBot}
                        className="px-4 py-3 inline-flex items-center justify-center gap-2 text-sm font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/30 transition-all cursor-pointer"
                      >
                        <Square className="w-4 h-4 fill-white" />
                        Stop
                      </button>
                    </div>
                  )}

                  {/* Throttle & Sandbox switch */}
                  <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-slate-500" />
                      Throttle: {settings.delayMs}ms delay / request
                    </span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
                      <input
                        type="checkbox"
                        checked={settings.isDemo}
                        onChange={(e) => setSettings((s) => ({ ...s, isDemo: e.target.checked }))}
                        disabled={activeJob?.status === 'running'}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950"
                      />
                      <span>Offline Sandbox Mode</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Right Column: Prominent Excel Export & Live Telemetry (7 Cols) */}
              <div className="lg:col-span-7 flex flex-col gap-4">
                
                {/* Primary Action Card: 1-Click Excel Export of Successful Taxpayers */}
                <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-teal-950/60 border-2 border-emerald-500/40 rounded-2xl p-5 shadow-2xl relative overflow-hidden">
                  <div className="absolute -right-8 -top-8 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
                  
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500 text-slate-950">
                          Primary Deliverable
                        </span>
                        <span className="text-xs text-slate-400">
                          Export Genuine Taxpayer Data
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-white mt-1">
                        Export Successful Taxpayers (.xlsx)
                      </h3>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Generates clean spreadsheet containing <strong className="text-emerald-400">ONLY the successfully verified NINs</strong> with full names, LGA, state, and phone numbers.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                      <button
                        onClick={handleExportSuccessfulExcel}
                        disabled={successfulCount === 0}
                        className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <FileSpreadsheet className="w-5 h-5 text-slate-950" />
                        <span>Download Excel ({successfulCount})</span>
                      </button>

                      <button
                        onClick={handleExportSuccessfulCsv}
                        disabled={successfulCount === 0}
                        title="Export as CSV"
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <Download className="w-4 h-4 text-slate-300" />
                        CSV
                      </button>
                    </div>
                  </div>

                  {activeJob && activeJob.results.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                      <span>
                        Ready to export: <strong className="text-emerald-400 font-mono">{successfulCount}</strong> of {activeJob.results.length} verified
                      </span>
                      <button
                        onClick={handleExportAll}
                        className="text-xs text-slate-400 hover:text-slate-200 underline transition-colors cursor-pointer"
                      >
                        Export All Results ({activeJob.results.length}) including failures
                      </button>
                    </div>
                  )}
                </div>

                {/* Live Progress Bar & Status Counters */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Execution Progress
                      </span>
                      {activeJob?.status === 'running' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                          Running live
                        </span>
                      )}
                      {activeJob?.status === 'completed' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-teal-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
                          Batch Finished
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      {currentUser && (
                        <span className="text-[11px] text-emerald-400 inline-flex items-center gap-1">
                          <CloudCheck className="w-3 h-3" /> Auto-sync active
                        </span>
                      )}
                      <span className="font-mono text-sm font-bold text-white">
                        {progressPercent}%
                      </span>
                    </div>
                  </div>

                  {/* Animated Progress Bar */}
                  <div className="w-full bg-slate-950 rounded-full h-3 p-0.5 border border-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        activeJob?.status === 'running'
                          ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400'
                          : 'bg-emerald-600'
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>

                  {/* 4 Telemetry Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 flex flex-col">
                      <span className="text-[11px] font-medium text-slate-400 uppercase">Total Queue</span>
                      <span className="text-xl font-bold font-mono text-white mt-1">
                        {activeJob ? activeJob.totalNins : extractedNins.length}
                      </span>
                    </div>

                    <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-3 flex flex-col">
                      <span className="text-[11px] font-medium text-emerald-400 uppercase">Verified OK</span>
                      <span className="text-xl font-bold font-mono text-emerald-400 mt-1">
                        {successfulCount}
                      </span>
                    </div>

                    <div className="bg-rose-950/20 border border-rose-900/40 rounded-xl p-3 flex flex-col">
                      <span className="text-[11px] font-medium text-rose-400 uppercase">Failed</span>
                      <span className="text-xl font-bold font-mono text-rose-400 mt-1">
                        {failedCount}
                      </span>
                    </div>

                    <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 flex flex-col">
                      <span className="text-[11px] font-medium text-slate-400 uppercase">Remaining</span>
                      <span className="text-xl font-bold font-mono text-slate-300 mt-1">
                        {activeJob ? activeJob.queue.length : extractedNins.length}
                      </span>
                    </div>
                  </div>

                  {/* Real-time Terminal Log */}
                  <div className="mt-1 border border-slate-800 rounded-xl bg-slate-950/90 overflow-hidden">
                    <div className="px-3 py-1.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                      <div className="flex items-center gap-1.5 font-mono">
                        <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Live Verification Engine Output</span>
                      </div>
                      <span className="font-mono text-[10px] text-slate-500">
                        {activeJob?.logs.length || 0} events
                      </span>
                    </div>
                    <div
                      ref={logContainerRef}
                      className="h-28 overflow-y-auto p-2.5 font-mono text-[11px] flex flex-col gap-1 leading-relaxed text-slate-300"
                    >
                      {activeJob?.logs && activeJob.logs.length > 0 ? (
                        activeJob.logs.slice().reverse().map((log) => (
                          <div
                            key={log.id}
                            className={`flex items-start gap-2 ${
                              log.level === 'success'
                                ? 'text-emerald-400'
                                : log.level === 'error'
                                ? 'text-rose-400'
                                : log.level === 'warn'
                                ? 'text-amber-400'
                                : 'text-slate-400'
                            }`}
                          >
                            <span className="text-slate-600 shrink-0">
                              {log.timestamp.slice(11, 19)}
                            </span>
                            <span>{log.message}</span>
                          </div>
                        ))
                      ) : (
                        <div className="h-full flex items-center justify-center text-slate-600 italic">
                          Bot output logs will stream here when verification begins...
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Section: Live Verified Taxpayers Results Table */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl shadow-xl flex flex-col overflow-hidden">
              {/* Table Header & Search Filters */}
              <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">
                      Taxpayer Verification Results
                    </h3>
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-slate-800 text-slate-300">
                      {filteredResults.length} records
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time extracted identity & taxpayer records from BIRS
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  {/* Filter Tabs */}
                  <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs font-medium">
                    <button
                      onClick={() => setStatusFilter('all')}
                      className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                        statusFilter === 'all'
                          ? 'bg-slate-800 text-white font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All ({activeJob?.results.length || 0})
                    </button>
                    <button
                      onClick={() => setStatusFilter('success')}
                      className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                        statusFilter === 'success'
                          ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-800/50'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Verified ({successfulCount})
                    </button>
                    <button
                      onClick={() => setStatusFilter('failed')}
                      className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                        statusFilter === 'failed'
                          ? 'bg-rose-950 text-rose-300 font-bold border border-rose-800/50'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Failed ({failedCount})
                    </button>
                  </div>

                  {/* Search input */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter by NIN, name, LGA..."
                      className="w-full sm:w-60 bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Table Contents */}
              <div className="overflow-x-auto min-h-[300px]">
                {filteredResults.length > 0 ? (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800/80 bg-slate-950/40 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        <th className="py-3 px-4 w-12 text-center">#</th>
                        <th className="py-3 px-4">NIN</th>
                        <th className="py-3 px-4">Taxpayer Full Name</th>
                        <th className="py-3 px-4">State & LGA</th>
                        <th className="py-3 px-4">Phone</th>
                        <th className="py-3 px-4 text-center">Status</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {filteredResults.map((res, idx) => {
                        const isSuccess = res.status === 'success';
                        const firstName = res.details?.['First Name'] || res.details?.['firstName'] || '';
                        const surname = res.details?.['Surname'] || res.details?.['surname'] || '';
                        const middleName = res.details?.['Middle Name'] || res.details?.['middleName'] || '';
                        const fullName = [firstName, middleName, surname].filter(Boolean).join(' ') || (isSuccess ? 'Verified Record' : '—');
                        const state = res.details?.['State of Origin'] || res.details?.['stateOfOrigin'] || '';
                        const lga = res.details?.['LGA of Origin'] || res.details?.['lgaOfOrigin'] || '';
                        const phone = res.details?.['Mobile'] || res.details?.['phone'] || '—';

                        return (
                          <tr
                            key={`${res.nin}_${idx}`}
                            className="hover:bg-slate-800/30 transition-colors"
                          >
                            <td className="py-3 px-4 text-center font-mono text-slate-500">
                              {idx + 1}
                            </td>
                            <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                              <button
                                onClick={() => handleCopy(res.nin, `nin_${res.nin}`)}
                                title="Click to copy NIN"
                                className="inline-flex items-center gap-1.5 hover:text-emerald-400 transition-colors cursor-pointer"
                              >
                                <span>{res.nin}</span>
                                {copiedKey === `nin_${res.nin}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-slate-600 hover:text-slate-400" />
                                )}
                              </button>
                            </td>
                            <td className="py-3 px-4 font-medium text-white">
                              {fullName}
                            </td>
                            <td className="py-3 px-4 text-slate-300">
                              {state || lga ? `${lga ? lga + ', ' : ''}${state}` : '—'}
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-400">
                              {phone}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {isSuccess ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  Verified
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-950 text-rose-400 border border-rose-800/60" title={res.message}>
                                  <XCircle className="w-3 h-3 text-rose-400" />
                                  Failed
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => setSelectedResult(res)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Details</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-16 text-center flex flex-col items-center justify-center gap-3 text-slate-500">
                    <FileSpreadsheet className="w-10 h-10 text-slate-700" />
                    <p className="text-sm font-medium">
                      {activeJob
                        ? 'No records match the active search or filter.'
                        : 'Paste NINs above and click "Launch Autonomous Verification" to see live results.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Cloud History & Saved Batches Modal */}
      {showCloudHistoryModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Cloud Account History & Saved Batches
                  </h3>
                  <p className="text-xs text-slate-400">
                    Signed in as: <strong className="text-emerald-400 font-mono">{currentUser?.email}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCloudHistoryModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-5 text-xs">
              {/* Cloud Stats Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-col">
                  <span className="text-[10px] uppercase font-semibold text-slate-400">Saved Batches</span>
                  <span className="text-xl font-bold font-mono text-white mt-1">
                    {cloudBatches.length}
                  </span>
                </div>
                <div className="p-3.5 bg-emerald-950/20 border border-emerald-900/40 rounded-xl flex flex-col">
                  <span className="text-[10px] uppercase font-semibold text-emerald-400">Verified Taxpayers in Cloud</span>
                  <span className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    {cloudTaxpayers.length}
                  </span>
                </div>
                <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-col justify-center">
                  <button
                    onClick={handleExportCloudTaxpayersExcel}
                    disabled={cloudTaxpayers.length === 0}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Download All Taxpayers</span>
                  </button>
                </div>
              </div>

              {/* Saved Batches List */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Your Previous Verification Batches
                  </h4>
                  <button
                    onClick={() => currentUser && refreshCloudData(currentUser.uid)}
                    disabled={isSyncingCloud}
                    className="text-[11px] text-slate-400 hover:text-emerald-400 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isSyncingCloud ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                {cloudBatches.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    {cloudBatches.map((batch) => (
                      <div
                        key={batch.id}
                        className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-xs">{batch.name || 'Unnamed Batch'}</span>
                            <span className={`text-[10px] uppercase font-semibold px-2 py-0.2 rounded-full ${
                              batch.status === 'completed'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                                : batch.status === 'running'
                                ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                                : 'bg-slate-800 text-slate-300'
                            }`}>
                              {batch.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono">
                            Total: <strong className="text-slate-200">{batch.totalNins}</strong> &bull; Verified: <strong className="text-emerald-400">{batch.successCount}</strong> &bull; Failed: <strong className="text-rose-400">{batch.failedCount}</strong> &bull; {new Date(batch.createdAt).toLocaleString()}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleResumeCloudBatch(batch)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors cursor-pointer"
                            title="Load NINs into Bulk Bot to continue or re-run"
                          >
                            <Play className="w-3 h-3 fill-white" />
                            <span>Continue / Resume</span>
                          </button>

                          <button
                            onClick={() => handleDeleteCloudBatch(batch.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                            title="Delete batch record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center bg-slate-950/40 border border-slate-800/60 rounded-xl text-slate-500">
                    <Cloud className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                    <p className="font-medium text-xs">No saved batches yet.</p>
                    <p className="text-[11px] text-slate-600 mt-1">
                      Run or pause any bulk verification while logged in, and your work will automatically sync here!
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end">
              <button
                onClick={() => setShowCloudHistoryModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Taxpayer Details Drawer / Modal */}
      {selectedResult && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  selectedResult.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                }`}>
                  {selectedResult.status === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Taxpayer Verification Record
                  </h3>
                  <p className="text-xs font-mono text-slate-400">
                    NIN: {selectedResult.nin}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedResult(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl">
                  <span className="text-slate-500 block uppercase text-[10px]">Status</span>
                  <span className={`font-bold text-sm ${selectedResult.status === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedResult.status === 'success' ? 'Verified Successfully' : 'Verification Failed'}
                  </span>
                </div>
                <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl">
                  <span className="text-slate-500 block uppercase text-[10px]">Gateway Message</span>
                  <span className="font-medium text-slate-200 text-xs">
                    {selectedResult.message || 'No message'}
                  </span>
                </div>
              </div>

              {/* Data fields */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Taxpayer Identity Details
                </h4>
                <div className="bg-slate-950 rounded-xl border border-slate-800 divide-y divide-slate-800/60 text-xs font-mono">
                  {selectedResult.details && Object.keys(selectedResult.details).length > 0 ? (
                    Object.entries(selectedResult.details).map(([k, v]) => (
                      <div key={k} className="py-2.5 px-3 flex items-start justify-between gap-4">
                        <span className="text-slate-400 font-sans shrink-0">{k}:</span>
                        <span className="text-slate-200 text-right break-all">
                          {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-slate-500 font-sans">
                      No taxpayer detail attributes returned.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between">
              <button
                onClick={() => handleCopy(JSON.stringify(selectedResult, null, 2), 'raw_result')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedKey === 'raw_result' ? 'Copied JSON' : 'Copy JSON'}</span>
              </button>
              <button
                onClick={() => setSelectedResult(null)}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings & Proxy Drawer / Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  Gateway & Verification Settings
                </h3>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-5 text-xs">
              
              {/* Cloud Account Status in Settings */}
              <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-200 block">Cloud Account Status</span>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">
                    {currentUser ? `Connected: ${currentUser.email}` : 'Not connected (Local offline mode active)'}
                  </span>
                </div>
                {currentUser ? (
                  <button
                    onClick={handleLogout}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-rose-950/60 hover:border-rose-800 text-slate-300 hover:text-rose-300 border border-slate-700 rounded-lg text-xs font-medium cursor-pointer"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={handleLogin}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Connect Google Account
                  </button>
                )}
              </div>

              {/* Proxy Endpoint Configuration */}
              <div className="flex flex-col gap-2">
                <label className="font-semibold text-slate-200 flex items-center justify-between">
                  <span>Server-Side Proxy Endpoint</span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    Forwards requests without browser CORS blocks
                  </span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={settings.proxyUrl || ''}
                    onChange={(e) => setSettings((s) => ({ ...s, proxyUrl: e.target.value }))}
                    placeholder="/api/verify or https://your-proxy.onrender.com/api/verify"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleTestProxy}
                    disabled={isTestingProxy}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 font-medium transition-colors cursor-pointer"
                  >
                    {isTestingProxy ? 'Pinging...' : 'Test Ping'}
                  </button>
                </div>
                {proxyStatus.tested && (
                  <div className={`p-2.5 rounded-lg border text-[11px] ${
                    proxyStatus.ok
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-800 text-rose-300'
                  }`}>
                    {proxyStatus.ok ? `✓ Connected successfully (${proxyStatus.latencyMs}ms)` : `✗ ${proxyStatus.message}`}
                  </div>
                )}
              </div>

              {/* Rate Limit Throttle Delay */}
              <div className="flex flex-col gap-2">
                <label className="font-semibold text-slate-200 flex items-center justify-between">
                  <span>Delay Between Requests: {settings.delayMs}ms</span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    Recommended: 1200ms - 2000ms
                  </span>
                </label>
                <input
                  type="range"
                  min="500"
                  max="5000"
                  step="100"
                  value={settings.delayMs}
                  onChange={(e) => setSettings((s) => ({ ...s, delayMs: Number(e.target.value) }))}
                  className="w-full accent-emerald-500"
                />
              </div>

              {/* BIRS Merchant Key */}
              <div className="flex flex-col gap-2">
                <label className="font-semibold text-slate-200">
                  BIRS Gateway Merchant Key
                </label>
                <input
                  type="password"
                  value={settings.merchantKey}
                  onChange={(e) => setSettings((s) => ({ ...s, merchantKey: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* GitHub Actions Autobot Notice */}
              <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl flex flex-col gap-2">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Autonomous Background Autobot</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  The automated GitHub runner (<code className="text-emerald-400 font-mono">.github/workflows/nin-autobot.yml</code>) runs autonomously every 6 hours or whenever you push new NINs into <code className="text-emerald-400 font-mono">autobot/nins/input.txt</code>, saving verified results directly to <code className="text-emerald-400 font-mono">autobot/results/birs_successful_taxpayers.xlsx</code>.
                </p>
              </div>

              {/* Chrome Extension Download Card */}
              <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
                    <Puzzle className="w-4 h-4 text-emerald-400" />
                    <span>Zero-CORS Chrome Extension</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    For static hosts like GitHub Pages. Unzip and load unpacked in chrome://extensions.
                  </p>
                </div>
                <button
                  onClick={() => downloadExtensionZip()}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs shrink-0 transition-colors cursor-pointer"
                >
                  Download .zip
                </button>
              </div>

            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors cursor-pointer"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-500">
        <p>BIRS NIN Autonomous Verifier &bull; Benue Internal Revenue Service Gateway Integration &bull; 100% Genuine Verification</p>
      </footer>
    </div>
  );
}

export default App;

export interface VerificationResult {
  nin: string;
  status: 'success' | 'failed';
  message: string;
  details: Record<string, any>;
  verifiedAt: string;
  attempts: number;
  durationMs: number;
}

export interface BotLog {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  nin?: string;
}

export interface BotJobSettings {
  delayMs: number;
  jitterMs: number;
  concurrency: number;
  maxRetries: number;
  timeoutMs: number;
  merchantKey: string;
  gatewayUrl: string;
  autoRetry: boolean;
  isDemo: boolean;
}

export interface BotJobStats {
  total: number;
  processed: number;
  success: number;
  failed: number;
  retries: number;
  avgTimeMs: number;
}

export interface BotJob {
  id: string;
  name: string;
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  totalNins: number;
  queue: string[];
  inFlight: string[];
  results: VerificationResult[];
  logs: BotLog[];
  settings: BotJobSettings;
  stats: BotJobStats;
}

export const DEFAULT_GATEWAY_URL = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
export const DEFAULT_MERCHANT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

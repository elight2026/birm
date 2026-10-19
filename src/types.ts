/**
 * Core Domain Interfaces & Types for BIRS NIN Verification System
 * 
 * Provides centralized type definitions for autonomous bot execution,
 * individual NIN verification lookups, telemetry, batch reporting,
 * and application engine state.
 */

export interface TaxpayerDetails {
  'NIN': string;
  'First Name'?: string;
  'Surname'?: string;
  'Middle Name'?: string;
  'Date of Birth'?: string;
  'Gender'?: string;
  'Mobile'?: string;
  'State of Origin'?: string;
  'LGA of Origin'?: string;
  'Taxpayer ID (TIN)'?: string;
  'Tracking ID'?: string;
  'Residential Address'?: string;
  'Verification Source'?: string;
  [key: string]: any;
}

export interface VerificationResult {
  nin: string;
  status: 'success' | 'failed';
  message: string;
  details: TaxpayerDetails | Record<string, any>;
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

export interface SingleLookupResult {
  status: 'success' | 'failed';
  message: string;
  details?: Record<string, any>;
  durationMs: number;
}

export type EngineMode = 'server' | 'browser';

export type ActiveTab = 'bot' | 'single' | 'standalone' | 'settings';

export type ResultFilter = 'all' | 'success' | 'failed';

export type LogFilter = 'all' | 'error';

export type ExportFormat = 'xlsx' | 'csv';

export type ExportFilter = 'all' | 'success';

export interface ToastNotification {
  message: string;
  type: 'info' | 'success' | 'error';
}

export const DEFAULT_GATEWAY_URL = 'https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate';
export const DEFAULT_MERCHANT_KEY = 'e6385c73adba4eb6807c0ec858fd8f5c';

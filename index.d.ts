export declare const VERSION: string;

export interface Recommendation {
  action: "accept" | "review" | "reject";
  reasons: string[];
}

/** Common fields; see https://verified.net/docs for every field of each lookup. */
export interface LookupResult {
  id: string;
  credits_charged: number;
  cached: boolean;
  created_at: string;
  valid: boolean;
  risk_score: number | null;
  recommendation?: Recommendation;
  [field: string]: unknown;
}

export interface BulkJob {
  id: string;
  status: "queued" | "running" | "completed" | "cancelled";
  type: string;
  tier: string | null;
  rows: number;
  unique_values: number;
  processed: number;
  valid: number;
  invalid: number;
  skipped: number;
  credits_charged: number;
  progress: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  webhook: { url: string; status: string; attempts: number } | null;
  webhook_secret?: string;
}

export interface BulkItem {
  input: string;
  status: "pending" | "running" | "done" | "insufficient_credits" | "cancelled" | "error";
  result: LookupResult | null;
}

export declare class VerifiedError extends Error {
  status: number;
  code: string;
  requestId: string | null;
  retryAfter: number | null;
}

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export declare class Client {
  constructor(options?: ClientOptions);
  email(address: string, opts?: { bypassCache?: boolean }): Promise<LookupResult>;
  phone(number: string, opts?: { defaultCountry?: string; bypassCache?: boolean }): Promise<LookupResult>;
  carrier(number: string, opts?: { defaultCountry?: string; bypassCache?: boolean }): Promise<LookupResult>;
  ip(ip: string, opts?: { bypassCache?: boolean }): Promise<LookupResult>;
  contact(email: string, opts?: { name?: string; phone?: string; defaultCountry?: string }): Promise<LookupResult>;
  reversePhone(phone: string, opts?: { tier?: "standard" | "premium"; defaultCountry?: string; bypassCache?: boolean }): Promise<LookupResult>;
  reverseEmail(email: string, opts?: { bypassCache?: boolean }): Promise<LookupResult>;
  account(): Promise<Record<string, unknown>>;
  createBulkJob(
    type: "email" | "phone" | "ip" | "carrier" | "reverse_phone" | "reverse_email",
    items: Iterable<string>,
    opts?: { defaultCountry?: string; tier?: "standard" | "premium"; webhookUrl?: string; idempotencyKey?: string },
  ): Promise<BulkJob>;
  bulkJobs(): Promise<BulkJob[]>;
  bulkJob(jobId: string): Promise<BulkJob>;
  cancelBulkJob(jobId: string): Promise<BulkJob>;
  bulkResults(jobId: string): AsyncGenerator<BulkItem, void, unknown>;
  bulkResultsCsv(jobId: string): Promise<string>;
  waitForBulkJob(jobId: string, opts?: { pollMs?: number; timeoutMs?: number }): Promise<BulkJob>;
}

export default Client;

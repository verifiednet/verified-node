// Official Node.js client for the Verified.net API (https://verified.net/docs). No dependencies; Node 18+.
import { randomUUID } from "node:crypto";

export const VERSION = "1.0.0";
const DEFAULT_BASE_URL = "https://api.verified.net";

/** An error answer from the API, or a network failure (status 0, code "network_error"). */
export class VerifiedError extends Error {
  constructor(status, code, message, requestId = null, retryAfter = null) {
    super(`${status} ${code}: ${message}`);
    this.name = "VerifiedError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false));

export class Client {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey]  default: process.env.VERIFIED_KEY
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeout] milliseconds per request (default 15000)
   * @param {number} [options.maxRetries] retries after 429 or a network error (default 2)
   */
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, timeout = 15000, maxRetries = 2 } = {}) {
    this.apiKey = apiKey || process.env.VERIFIED_KEY || "";
    if (!this.apiKey) throw new Error("No API key: pass { apiKey } or set VERIFIED_KEY.");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeout = timeout;
    this.maxRetries = maxRetries;
  }

  // -- lookups --------------------------------------------------------------------------
  email(address, { bypassCache } = {}) {
    return this.#request("POST", "/v1/email", clean({ address, bypass_cache: bypassCache }));
  }
  phone(number, { defaultCountry, bypassCache } = {}) {
    return this.#request("POST", "/v1/phone", clean({ number, default_country: defaultCountry, bypass_cache: bypassCache }));
  }
  carrier(number, { defaultCountry, bypassCache } = {}) {
    return this.#request("POST", "/v1/carrier", clean({ number, default_country: defaultCountry, bypass_cache: bypassCache }));
  }
  ip(ip, { bypassCache } = {}) {
    return this.#request("POST", "/v1/ip", clean({ ip, bypass_cache: bypassCache }));
  }
  contact(email, { name, phone, defaultCountry } = {}) {
    return this.#request("POST", "/v1/contact", clean({ email, name, phone, default_country: defaultCountry }));
  }
  reversePhone(phone, { tier = "standard", defaultCountry, bypassCache } = {}) {
    return this.#request("POST", "/v1/reverse/phone", clean({ phone, tier, default_country: defaultCountry, bypass_cache: bypassCache }));
  }
  reverseEmail(email, { bypassCache } = {}) {
    return this.#request("POST", "/v1/reverse/email", clean({ email, bypass_cache: bypassCache }));
  }
  account() {
    return this.#request("GET", "/v1/account");
  }

  // -- bulk jobs ------------------------------------------------------------------------------
  /** type: email, phone, ip, carrier, reverse_phone or reverse_email. Safe to retry (Idempotency-Key). */
  createBulkJob(type, items, { defaultCountry, tier, webhookUrl, idempotencyKey } = {}) {
    const body = clean({ type, items: [...items], default_country: defaultCountry, tier, webhook_url: webhookUrl });
    return this.#request("POST", "/v1/bulk/jobs", body, { "Idempotency-Key": idempotencyKey || randomUUID() });
  }
  async bulkJobs() {
    return (await this.#request("GET", "/v1/bulk/jobs")).jobs;
  }
  bulkJob(jobId) {
    return this.#request("GET", `/v1/bulk/jobs/${encodeURIComponent(jobId)}`);
  }
  cancelBulkJob(jobId) {
    return this.#request("DELETE", `/v1/bulk/jobs/${encodeURIComponent(jobId)}`);
  }
  /** Every result item, page after page. */
  async *bulkResults(jobId) {
    for (let page = 1; ; page++) {
      const data = await this.#request("GET", `/v1/bulk/jobs/${encodeURIComponent(jobId)}/results?page=${page}`);
      yield* data.items;
      if (!data.has_next) return;
    }
  }
  /** The uploaded rows plus result columns, as CSV text. */
  bulkResultsCsv(jobId) {
    return this.#request("GET", `/v1/bulk/jobs/${encodeURIComponent(jobId)}/results?format=csv`, undefined, {}, true);
  }
  /** Poll until the job is completed or cancelled. */
  async waitForBulkJob(jobId, { pollMs = 5000, timeoutMs } = {}) {
    const deadline = timeoutMs ? Date.now() + timeoutMs : null;
    for (;;) {
      const job = await this.bulkJob(jobId);
      if (job.status === "completed" || job.status === "cancelled") return job;
      if (deadline && Date.now() > deadline) throw new Error(`bulk job ${jobId} still ${job.status}`);
      await sleep(pollMs);
    }
  }

  // -- transport ----------------------------------------------------------------------------------
  async #request(method, path, body, extraHeaders = {}, raw = false) {
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": `verified-net-node/${VERSION}`,
      ...extraHeaders,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // Network errors are retried only where a retry can't charge twice: reads and idempotent bulk creation.
    const retryNetwork = method === "GET" || "Idempotency-Key" in extraHeaders;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(this.baseUrl + path, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (err) {
        if (retryNetwork && attempt < this.maxRetries) { await sleep(2 ** (attempt + 1) * 1000); continue; }
        throw new VerifiedError(0, "network_error", err?.message || String(err));
      }
      if (res.ok) return raw ? res.text() : res.json();
      let detail = {};
      try { detail = (await res.json())?.error || {}; } catch { /* not JSON */ }
      const retryAfter = Number(res.headers.get("retry-after")) || null;
      if (res.status === 429 && attempt < this.maxRetries) {
        await sleep(Math.min(retryAfter || 2 ** (attempt + 1), 30) * 1000);
        continue;
      }
      throw new VerifiedError(res.status, detail.code || "http_error", detail.message || res.statusText,
                              detail.request_id || res.headers.get("x-request-id"), retryAfter);
    }
  }
}

export default Client;

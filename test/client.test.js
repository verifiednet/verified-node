// Runs against a fake API server (no network, no key). The Python client is tested against the real API.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client, VerifiedError } from "../index.js";

const seen = [];
let tooMany = 1;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined });
    const send = (status, obj, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(obj));
    };
    if (req.headers.authorization !== "Bearer k_test") return send(401, { error: { code: "unauthorized", message: "Invalid or revoked API key.", request_id: "r".repeat(24) } });
    if (req.url === "/v1/email") return send(200, { valid: true, recommendation: { action: "accept", reasons: [] } });
    if (req.url === "/v1/ip" && tooMany-- > 0) return send(429, { error: { code: "rate_limited", message: "slow down" } }, { "Retry-After": "0" });
    if (req.url === "/v1/ip") return send(200, { valid: true });
    if (req.url === "/v1/bulk/jobs" && req.method === "POST") return send(202, { id: "j1", status: "queued" });
    if (req.url === "/v1/bulk/jobs/j1") return send(200, { id: "j1", status: "completed" });
    if (req.url.startsWith("/v1/bulk/jobs/j1/results?format=csv")) { res.writeHead(200, { "Content-Type": "text/csv" }); return res.end("input,vfy_status\na,done\n"); }
    if (req.url === "/v1/bulk/jobs/j1/results?page=1") return send(200, { items: [{ input: "a" }], has_next: true });
    if (req.url === "/v1/bulk/jobs/j1/results?page=2") return send(200, { items: [{ input: "b" }], has_next: false });
    send(404, { error: { code: "not_found", message: "nope" } });
  });
});
let c;
before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  c = new Client({ apiKey: "k_test", baseUrl: `http://127.0.0.1:${server.address().port}/` });
});
after(() => server.close());

test("email posts the address with auth and JSON", async () => {
  const r = await c.email("jane@example.com");
  assert.equal(r.recommendation.action, "accept");
  const req = seen.at(-1);
  assert.deepEqual(req.body, { address: "jane@example.com" });
  assert.equal(req.headers["content-type"], "application/json");
  assert.match(req.headers["user-agent"], /^verified-net-node\//);
});

test("429 is retried after Retry-After", async () => {
  const before = seen.length;
  assert.equal((await c.ip("8.8.8.8")).valid, true);
  assert.equal(seen.length - before, 2);
});

test("errors become VerifiedError with code and request id", async () => {
  const bad = new Client({ apiKey: "wrong", baseUrl: c.baseUrl });
  await assert.rejects(bad.account(), (e) => e instanceof VerifiedError && e.status === 401 && e.code === "unauthorized" && e.requestId.length === 24);
  await assert.rejects(c.bulkJob("nope"), (e) => e.status === 404 && e.code === "not_found");
});

test("bulk: idempotency key, paging, csv, wait", async () => {
  const job = await c.createBulkJob("email", new Set(["a", "b"]));
  assert.equal(job.id, "j1");
  const req = seen.at(-1);
  assert.deepEqual(req.body, { type: "email", items: ["a", "b"] });
  assert.ok(req.headers["idempotency-key"].length >= 32);
  const items = [];
  for await (const i of c.bulkResults("j1")) items.push(i.input);
  assert.deepEqual(items, ["a", "b"]);
  assert.match(await c.bulkResultsCsv("j1"), /^input,vfy_status/);
  assert.equal((await c.waitForBulkJob("j1", { pollMs: 1 })).status, "completed");
});

test("network errors on lookups are not retried", async () => {
  const dead = new Client({ apiKey: "k", baseUrl: "http://127.0.0.1:9", maxRetries: 2 });
  const t = Date.now();
  await assert.rejects(dead.email("a@b.co"), (e) => e.code === "network_error");
  assert.ok(Date.now() - t < 1500);
});

test("missing key throws", () => {
  const saved = process.env.VERIFIED_KEY;
  delete process.env.VERIFIED_KEY;
  assert.throws(() => new Client(), /No API key/);
  if (saved) process.env.VERIFIED_KEY = saved;
});

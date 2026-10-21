# verified-net

Official Node.js client for the [Verified.net](https://verified.net) API: email verification, phone validation,
live carrier and porting lookups, IP intelligence, contact verification, reverse lookups and bulk jobs.
No dependencies; Node 18+ (uses the built-in `fetch`). TypeScript types included.

```bash
npm install verified-net
```

## Quick start

Create an API key at [app.verified.net](https://app.verified.net/keys) and set it as `VERIFIED_KEY`.

```js
import { Client, VerifiedError } from "verified-net";

const client = new Client(); // or new Client({ apiKey: "vfy_live_..." })

const result = await client.email("jane.doe@gmial.com");
console.log(result.recommendation); // { action: 'review', reasons: [ 'possible_typo' ] }
console.log(result.did_you_mean);   // jane.doe@gmail.com

const phone = await client.phone("(202) 456-1111", { defaultCountry: "US" });
console.log(phone.line_type, phone.voip);

try {
  await client.carrier("+12024561111");
} catch (e) {
  if (e instanceof VerifiedError) console.log(e.status, e.code, e.message, e.requestId);
}
```

Every result has `recommendation.action`: `accept`, `review` or `reject`, with `reasons`. Field reference:
[verified.net/docs](https://verified.net/docs).

## Methods

| Method | Endpoint | Credits |
|---|---|---|
| `email(address)` | `POST /v1/email` | 1 |
| `phone(number, { defaultCountry })` | `POST /v1/phone` | 1 |
| `carrier(number)` | `POST /v1/carrier` (US/Canada) | 3 |
| `ip(ip)` | `POST /v1/ip` | 1 |
| `contact(email, { name, phone })` | `POST /v1/contact` | 1 |
| `reversePhone(phone, { tier })` | `POST /v1/reverse/phone` | 10 / 25, only when found |
| `reverseEmail(email)` | `POST /v1/reverse/email` | 10, only when found |
| `account()` | `GET /v1/account` | free |

Invalid input is free, and the same value checked again within 7 days is free. Pass `{ bypassCache: true }` to
force a fresh (charged) check.

## Bulk jobs

```js
const job = await client.createBulkJob("email", ["a@example.com", "b@example.org"]);
await client.waitForBulkJob(job.id);
for await (const item of client.bulkResults(job.id)) {
  console.log(item.input, item.status, item.result?.recommendation.action);
}
const csv = await client.bulkResultsCsv(job.id);
```

Types: `email`, `phone`, `ip`, `carrier`, `reverse_phone`, `reverse_email`. Up to 100,000 values per job.
`createBulkJob` sends an `Idempotency-Key`, so a retry never creates a second job.

## Errors and retries

API errors throw `VerifiedError` with `status`, `code` (`insufficient_credits`, `rate_limited`, `unauthorized`,
`invalid_request`, ...), `message` and `requestId`. A 429 is retried after `Retry-After` (`maxRetries: 2` by
default); network errors are retried for reads and bulk job creation only, so a lookup is never charged twice.

## License

MIT

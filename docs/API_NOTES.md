# Higgsfield API — integration notes (for Tauri/Rust backend)

Researched 2026-11-08 from the public docs and the SDK sources. **No authenticated calls were made.** Facts are cited inline; anything not stated by a source is marked **UNVERIFIED**.

Key sources:

- Index: https://docs.higgsfield.ai/docs/llms.txt
- OpenAPI (supplementary, only covers ~6 models): https://docs.higgsfield.ai/docs/openapi.json (`servers: https://api.higgsfield.ai`, version 2.0.0)
- Python SDK: https://github.com/higgsfield-ai/higgsfield-client (PyPI `higgsfield-client` 0.2.0)
- Node SDK: https://github.com/higgsfield-ai/higgsfield-js (npm `@higgsfield/client` 0.2.6, import `@higgsfield/client/v2`)

## 1. Base URL and auth

- Base URL: `https://api.higgsfield.ai` — [how-to/introduction](https://docs.higgsfield.ai/docs/how-to/introduction.md), [FAQ](https://docs.higgsfield.ai/docs/help/faq.md); also `BASE_URL` in Python SDK `src/higgsfield_client/http/client.py`.
- Header: `Authorization: Key <KEY_ID>:<KEY_SECRET>` — **not** Bearer. [authentication](https://docs.higgsfield.ai/docs/authentication.md), [FAQ](https://docs.higgsfield.ai/docs/help/faq.md).
- Legacy alternative headers `hf-api-key` / `hf-secret` still accepted; don't use for new code. [headers](https://docs.higgsfield.ai/docs/api-reference/headers.md)
- Credentials (key ID + secret) are created in https://console.higgsfield.ai.
- Bad/missing credentials → `401 {"detail":"Invalid credentials"}`. Disabled/expired key → `403` with `Cache-Control: no-store`. [headers](https://docs.higgsfield.ai/docs/api-reference/headers.md)
- Model-level access restrictions may give `404`, `423` or `503`. [authentication](https://docs.higgsfield.ai/docs/authentication.md)
- Env var conventions (SDKs only; the API itself does not read env vars):
  - Python: `HF_KEY="id:secret"`, or `HF_API_KEY` + `HF_API_SECRET` (`src/higgsfield_client/auth.py`).
  - Node: `HF_CREDENTIALS` or `HF_KEY` (`"id:secret"`), fallback `HF_API_KEY` + `HF_API_SECRET` (`src/auth.ts`).
  - Docs/curl examples use `HF_API_KEY_ID` + `HF_API_KEY_SECRET` ([quickstart](https://docs.higgsfield.ai/docs/quickstart.md)).
  - Recommendation for the app: accept one `KEY_ID:KEY_SECRET` string, split on the first `:`, store in OS keychain.
- Docs warn: never ship secrets in browser/mobile code. A desktop app with a user-supplied key in the Rust backend (not the webview) is the safest pattern available; keep it out of the JS side and out of logs/URLs. [authentication](https://docs.higgsfield.ai/docs/authentication.md)

## 2. Endpoints

| Method | Path                                                 | Purpose                                | Source                                                                                             |
| ------ | ---------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| POST   | `/{model_id}` e.g. `/higgsfield-ai/soul/v2/standard` | Submit generation (model id = path)    | [quickstart](https://docs.higgsfield.ai/docs/quickstart.md), each model page                       |
| GET    | `/requests/{request_id}/status`                      | Status + output                        | [get-request-status](https://docs.higgsfield.ai/docs/api-reference/requests/get-request-status.md) |
| POST   | `/requests/{request_id}/cancel`                      | Cancel while queued                    | [cancel](https://docs.higgsfield.ai/docs/api-reference/requests/cancel-a-queued-request.md)        |
| DELETE | `/requests/{request_id}`                             | Delete finished request data           | [delete](https://docs.higgsfield.ai/docs/api-reference/requests/delete-request-data.md)            |
| POST   | `/files/generate-upload-url`                         | Get presigned upload URL               | [file-uploads](https://docs.higgsfield.ai/docs/concepts/file-uploads.md); SDK `_get_upload_url`    |
| POST   | `/estimate/{model_id}`                               | Price estimate in USD for given params | [billing-and-retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md)         |
| GET    | `/models/usage`                                      | Usage analytics (not billing)          | [usage-and-billing](https://docs.higgsfield.ai/docs/enterprise/usage-and-billing.md)               |
| POST   | `/v1/custom-references`                              | Soul ID character training             | [soul-id/create-character](https://docs.higgsfield.ai/docs/models/soul-id/create-character.md)     |
| GET    | `/v1/custom-references/{id}`                         | Soul ID training status                | same                                                                                               |

**Model listing endpoint: none documented.** Catalog is the docs (84 workflows: 17 image, 67 video per [models](https://docs.higgsfield.ai/docs/models.md)) and the Console. `models.json` in repo root is built from the docs pages.
**Credits/balance endpoint: none documented.** Balance is shown in Console only. `403` on submit = insufficient balance ([errors](https://docs.higgsfield.ai/docs/concepts/errors.md)). Use `/estimate/...` for per-request cost and `/models/usage` for spend history.

### Submit

```http
POST https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard?hf_webhook=<urlencoded https url>   (query optional)
Authorization: Key ID:SECRET
Content-Type: application/json
Idempotency-Key: 6f1c...-uuid          (optional, recommended)
Hf-Expires-After: 86400                (optional, 3600..account retention)

{"prompt": "A quiet alpine lake at sunrise, editorial photography"}
```

Response (`expires_after` = seconds retained after finishing):

```json
{
  "status": "queued",
  "request_id": "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
  "status_url": "https://api.higgsfield.ai/requests/d7e6c0f3-.../status",
  "cancel_url": "https://api.higgsfield.ai/requests/d7e6c0f3-.../cancel",
  "expires_after": 604800
}
```

Source: [requests](https://docs.higgsfield.ai/docs/concepts/requests.md). Docs say to use the returned URLs rather than building them yourself. The body is a flat JSON object of the model's inputs (no `{"input": ...}` wrapper at REST level; the Node SDK's `input` field is unwrapped — `src/v2/client.ts`). HTTP status code of a successful submit is not stated; **UNVERIFIED** (likely 200).

### Status

```json
{
  "status": "completed",
  "request_id": "...",
  "expires_at": "2026-10-31T12:05:12.481Z",
  "images": [{ "url": "https://cdn.example.com/image-1.jpg" }]
}
```

Video: `"video":{"url":"...mp4"}`. Audio: `"audio":{"url":...}` and `"audios":[...]`. Failed: `"error":"Generation failed"`. Some ops add `zip`, `mov`, `jsx`, `fbx`, `ply` artifacts (shape **UNVERIFIED**). [requests](https://docs.higgsfield.ai/docs/concepts/requests.md)

### Cancel

`POST /requests/{id}/cancel` → `202 Accepted`, empty body. Already started → `400`. Canceled queued requests are refunded. [requests](https://docs.higgsfield.ai/docs/concepts/requests.md), [billing](https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md)

### Delete

`DELETE /requests/{id}` → `200 {"request_id":"...","status":"deleted"}` (idempotent). Still running → `409`. [requests](https://docs.higgsfield.ai/docs/concepts/requests.md)

### Estimate

`POST /estimate/{model_id}` with the same JSON body as submit → `{"usd":"0.094"}` (string decimal; example value only). [billing-and-retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md). Whether it is free/rate-limited is **UNVERIFIED** (assumed free).

### Usage analytics

`GET /models/usage?start=&end=&timeframe=hour|day|week|month&model=&expand=time_series&expand=auth_method&page=&limit=` (range ≤31 days, limit ≤100). Returns `time_series[].results[]` with `model, unit, quantity, unit_price, cost, currency` as strings. Not a billing record; may lag. [usage-and-billing](https://docs.higgsfield.ai/docs/enterprise/usage-and-billing.md) (page is in the Enterprise section; availability to non-enterprise keys **UNVERIFIED**).

## 3. Job lifecycle

| Status        | Terminal | Meaning                           |
| ------------- | -------- | --------------------------------- |
| `queued`      | no       | waiting; cancelable               |
| `in_progress` | no       | running; not cancelable           |
| `completed`   | yes      | outputs present                   |
| `failed`      | yes      | may include `error`; not charged  |
| `nsfw`        | yes      | moderation rejection; not charged |
| `canceled`    | yes      | canceled before start; refunded   |

[requests](https://docs.higgsfield.ai/docs/concepts/requests.md). Soul ID uses different statuses: `not_ready, queued, in_progress, completed, failed` ([soul-id](https://docs.higgsfield.ai/docs/models/soul-id/create-character.md)).

Polling ([polling](https://docs.higgsfield.ai/docs/concepts/polling.md)): start 2 s, ×1.5 up to 10 s, add jitter, stop on terminal, app-level timeout per model. `401`→stop; `404`→stop; `5xx`/network→retry with backoff. Note the Node SDK's poll loop treats only `completed|nsfw|failed` as terminal (`src/v2/client.ts`) — include `canceled` in ours.

Idempotency ([idempotency](https://docs.higgsfield.ai/docs/concepts/idempotency.md)): `Idempotency-Key` 1–255 visible ASCII, UUID recommended; replay returns original `request_id` (receipt may still say `queued` — re-read status). Same key + different params → `422`. Generate key before sending, persist with the local job record.

Retention: outputs deleted 7 days after finishing (`expires_at`); download to local storage promptly. [billing-and-retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md), [data-retention](https://docs.higgsfield.ai/docs/enterprise/data-retention.md)

## 4. File uploads (presigned)

[file-uploads](https://docs.higgsfield.ai/docs/concepts/file-uploads.md)

1. `POST /files/generate-upload-url` body `{"content_type":"image/jpeg"}` →

```json
{
  "public_url": "https://cdn.example.com/input/example.jpeg",
  "upload_url": "https://storage.example.com/presigned-upload-url",
  "content_type": "image/jpeg",
  "upload_headers": { "Content-Type": "image/jpeg", "x-amz-tagging": "retention=temporary" }
}
```

2. `PUT` the raw bytes to `upload_url` with **every** header from `upload_headers`; **no** Higgsfield auth header. URL valid 1 hour.
3. Put `public_url` into the model's `image_url` / `video_url` / `audio_url` / `image_urls` etc.

Supported types: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/gif`, `audio/wav`, `audio/x-wav`, `video/mp4`. Content type must match. Max file size: **UNVERIFIED** (not documented). Lifetime of `public_url`: **UNVERIFIED** (tag `retention=temporary`). Python SDK falls back to `{"Content-Type": ct}` if `upload_headers` missing.

## 5. Webhooks

[webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md), [webhook-security](https://docs.higgsfield.ai/docs/enterprise/webhook-security.md)

- Pass `?hf_webhook=<URL-encoded https URL>` on the submit request. Must be HTTPS, publicly resolvable IPs, no credentials in URL; respond 2xx within 10 s.
- Fires on `completed`, `failed`, `nsfw` (not `canceled`). Envelope:

```json
{
  "request_id": "...",
  "status": "completed",
  "error": null,
  "expires_at": "...",
  "payload": { "images": [{ "url": "...", "content_type": "image/jpeg" }] }
}
```

(note: output is nested under `payload`, unlike the status endpoint).

- Signed with Standard Webhooks: headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<base64>` space-separated). Secret `whsec_...` from Console Settings (created on first reveal; unsigned until then; one per account). Verify: base64-decode secret after `whsec_`, HMAC-SHA256 over `{id}.{timestamp}.{raw body}`, base64, constant-time compare against any `v1,` entry, reject if |now−ts| > 5 min. Rotation: old secret valid 24 h, two signatures sent.
- Retries for 5xx/network up to 2 h; 4xx not retried; dedupe by `webhook-id`.
- Legacy `X-Webhook-Secret-Key` header (being retired). Node SDK still exposes `webhook: {url, secret}` but only puts `url` in the query string (`src/v2/client.ts`).
- **Desktop-app implication:** a desktop app normally has no public HTTPS endpoint, so polling is the practical primary path. Webhooks only make sense with a relay server (out of scope). INFERRED.

## 6. Errors

[errors](https://docs.higgsfield.ai/docs/concepts/errors.md): FastAPI envelope `{"detail": "..."}`; validation errors may have `detail` as a list; queue errors have `detail` as an object.

| Code | Meaning                                                     | Retry                     |
| ---- | ----------------------------------------------------------- | ------------------------- |
| 400  | invalid params / cancel after start                         | after fixing              |
| 401  | bad credentials                                             | no                        |
| 403  | insufficient balance (or disabled key)                      | after topping up          |
| 404  | request/model not found for account                         | no                        |
| 409  | delete while running                                        | after it finishes         |
| 422  | validation, idempotency mismatch, bad `Hf-Expires-After`    | no                        |
| 423  | model temporarily blocked                                   | later                     |
| 429  | `account_queue_full` or endpoint limit; honor `Retry-After` | yes, same idempotency key |
| 500  | server error                                                | yes, backoff              |
| 503  | model disabled / `admission_control_unavailable`            | yes, backoff              |

Every response has `X-Correlation-ID`; log it with `request_id`. Python SDK default retry: 3 retries, 0.2 s × 2^n, on 408/429/500/502/503/504 (`http/retry.py`).

## 7. Rate limits

[rate-limits](https://docs.higgsfield.ai/docs/concepts/rate-limits.md), [capacity](https://docs.higgsfield.ai/docs/enterprise/capacity.md)

- Primary limit is concurrency (per account, plus some per-model). Over concurrency → still accepted, stays `queued`.
- Queue cap = multiple of concurrency (each batch output counts). Full → `429`:

```json
{
  "detail": {
    "code": "account_queue_full",
    "message": "Too many queued generations for this account",
    "retryable": true,
    "limit": 40,
    "retry_after_seconds": 30
  }
}
```

- No rate-limit headers on success responses; limits visible only in Console. Polling limits not documented (**UNVERIFIED**).

## 8. Pricing / credits

[billing-and-retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md), [FAQ](https://docs.higgsfield.ai/docs/help/faq.md)

- Billing is in **USD** against a prepaid balance (not "credits" in the API docs). Funds expire 1 year after top-up. Enterprise can use invoices.
- Charged only on `completed`; `failed`/`nsfw` refunded; canceled-while-queued refunded. An amount may be reserved at submit.
- Per-model prices are mostly **not** on docs pages; use `POST /estimate/{model}` or the Console Playground. Exceptions captured in `models.json`: Ads Studio (~$0.084/image illustrative, token-based), Genjutsu Restyle (~$0.318/0.681/1.632 per source second at 480p/720p/1080p). Soul v2 standard example `0.094` USD appears in estimate and usage examples (illustrative).
- The consumer higgsfield.ai app's "credits" system is not part of this API — **UNVERIFIED** whether credits map to API balance.

## 9. SDK notes

- Python `higgsfield-client`: `subscribe`/`subscribe_async` (submit+poll), `submit`/`submit_async` → controller with `.status()`, `.result()`, `.cancel()`; `upload`, `upload_file`, `upload_image`. Builds `status_url = cancel_url-base = {BASE}/requests/{id}/...`. Also has an "agents" API (`/sessions`, `/sessions/{id}/messages`, `/sessions/{id}/interrupt`) not documented in the docs index — **UNVERIFIED**/out of scope.
- Node `@higgsfield/client/v2`: `config({credentials})`, `higgsfield.subscribe(endpoint, {input, webhook?, withPolling})`; server-only (blocks browser). Adds an obfuscated User-Agent in Node.
- Rust: no SDK; plain `reqwest` with the endpoints above is sufficient.

## 10. Open questions / unverified

1. No model-listing or balance endpoint — confirm with support/Discord; the app must ship a static registry (`models.json`) and refresh it from docs.
2. Exact HTTP code of successful submit (200 vs 201/202) and whether `expires_after` is always present.
3. Per-model pricing: only via `/estimate` (needs auth). Is `/estimate` free and does it require the model to be accessible to the account?
4. Upload max size, `public_url` lifetime, and whether uploaded URLs count toward retention.
5. Shape of extra artifacts (`zip`, `mov`, `fbx`, ...) in status responses.
6. Whether `/models/usage` works for non-enterprise keys.
7. Polling rate limits on `/requests/{id}/status`.
8. Model categories in `models.json` are INFERRED from path + inputs (e.g. "reference-to-video" classed as image-to-video; some accept video refs too).
9. Per-model timeouts are not published ("model-specific"); choose app-level timeouts (e.g. 10 min image, 30+ min video) — INFERRED.
10. Model availability is per-account (404/423/503); docs index says a model's absence from openapi.json doesn't mean it's unavailable, and preview vs production environments should not be silently substituted.

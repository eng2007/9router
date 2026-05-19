# xAI / Grok Provider Integration Plan

> Source of truth: `router-for-me/CLIProxyAPI` (Go). 9router mirrors xAI behavior 1:1.

## Objective

Add xAI (Grok) as a first-class provider in 9router, mirroring `router-for-me/CLIProxyAPI` 1:1. Support both OAuth (PKCE, loopback port 56121) and API-key auth. Implement the always-SSE Responses pipeline with `response.output_item.done` → `response.completed` patching, image generation/edit endpoints, video generation/edit/extension endpoints, the reasoning/thinking patcher, and full translator coverage (OpenAI Chat, OpenAI Responses, Claude/Anthropic Messages, Gemini → xAI Responses). Surface `grok-4` and family through the existing `/v1/{responses,chat/completions,messages,images,videos}` routes; integrate with 9router's `src/sse/` and `open-sse/` SSE pipelines, dashboard provider UI, and CLI login command.

## Reference: CLIProxyAPI → 9router File Mapping

| CLIProxyAPI (Go) | 9router (JS) |
|---|---|
| `internal/auth/xai/types.go` | `src/lib/oauth/constants/xai.js` |
| `internal/auth/xai/pkce.go` | `src/lib/oauth/utils/pkce.js` (reuse if exists) |
| `internal/auth/xai/xai.go` (discovery, exchange, refresh, JWT) | `src/lib/oauth/services/xai.js` |
| `internal/cmd/xai_login.go` | `cli/commands/xai-login.js` |
| `internal/runtime/executor/xai_executor.go` (chat/responses) | `src/lib/providers/xai/executor.js` |
| `internal/runtime/executor/xai_executor.go` (images) | `src/lib/providers/xai/images.js` |
| `internal/runtime/executor/xai_executor.go` (videos) | `src/lib/providers/xai/videos.js` |
| `internal/thinking/provider/xai/apply.go` | `src/lib/providers/xai/thinking.js` |
| `internal/translator/openai-responses/xai/*` | `src/lib/providers/xai/translators/openai-responses.js` |
| `internal/translator/openai/xai/*` | `src/lib/providers/xai/translators/openai-chat.js` |
| `internal/translator/claude/xai/*` | `src/lib/providers/xai/translators/claude.js` |
| `internal/translator/gemini/xai/*` | `src/lib/providers/xai/translators/gemini.js` |

## Constants (verbatim from `internal/auth/xai/types.go`)

| Name | Value |
|---|---|
| `clientId` | `b1a00492-073a-47ea-816f-4c329264a828` |
| `issuer` | `https://auth.x.ai` |
| `authEndpointPath` | `/oauth2/auth` |
| `tokenEndpointPath` | `/oauth2/token` |
| `discoveryPath` | `/.well-known/openid-configuration` |
| `scope` | `openid profile email offline_access grok-cli:access api:access` |
| `apiBaseURL` | `https://api.x.ai/v1` |
| `loopbackPort` | `56121` |
| `callbackPath` | `/callback` |
| `redirectURI` | `http://127.0.0.1:56121/callback` |
| `pkceVerifierBytes` | `96` |
| `refreshLeadTime` | `5 * 60` seconds |
| `userAgent` | `grok-cli/<version>` (mirror CLIProxyAPI UA) |

## Architecture Decisions

1. **Provider id `xai`** — matches CLIProxyAPI; registered in `src/shared/constants/providers.js` `AI_PROVIDERS` and `APIKEY_PROVIDERS`.
2. **Auth modes: OAuth + API key** — matches CLIProxyAPI; OAuth uses loopback PKCE on port 56121, API key uses `Authorization: Bearer <key>` directly.
3. **Translators: 4 inbound formats** — OpenAI Chat Completions, OpenAI Responses, Claude Messages, Gemini → xAI Responses; mirrors CLIProxyAPI translator dirs.
4. **Image + Video endpoints in scope** — `/v1/images/{generations,edits}`, `/v1/videos/{generations,edits,extensions,{id}}`; mirrors `xai_executor.go`.
5. **Always-SSE Responses pipeline** — xAI `/responses` always streams; non-stream callers must collect events and synthesize `response.completed` from `response.output_item.done`; matches CLIProxyAPI.
6. **SSE integration** — hook into existing `src/sse/` and `open-sse/`; xAI executor emits normalized SSE chunks consumed by these layers.

### File placement

- OAuth: `src/lib/oauth/{constants,services}/xai.js`
- Provider registry deltas: `src/shared/constants/providers.js`, `src/lib/oauth/providers.js`, `src/lib/providerNormalization.js`
- Provider runtime: `src/lib/providers/xai/{executor,thinking,images,videos,translators/*}.js`
- Routes: extend existing `src/app/api/v1/{responses,chat/completions,messages,images}/route.js`; add new `videos/*` routes
- DB: token rows live in existing OAuth tables (mirror claude/codex/gemini schema usage in `src/lib/db/`)
- CLI: `cli/commands/xai-login.js` + register in `cli/index.js`
- Dashboard UX: existing provider grid renders from registry; add icon + label in `src/shared/constants/providers.js`

---

## Phase 1 — OAuth + API key auth

### Step 1.1 — Constants module
- Create `src/lib/oauth/constants/xai.js` with all values from the constants table
- Export `XAI_OAUTH = { clientId, issuer, authEndpoint, tokenEndpoint, discoveryUrl, scope, apiBaseUrl, redirectUri, loopbackPort, callbackPath, pkceVerifierBytes, refreshLeadSeconds }`
- Export `XAI_API_BASE = 'https://api.x.ai/v1'`
- Export `XAI_USER_AGENT` (match CLIProxyAPI UA)

### Step 1.2 — PKCE helper
- Confirm `src/lib/oauth/utils/pkce.js` exists; if missing, create
- Implement `generateVerifier(bytes = 96)` (base64url, no padding)
- Implement `challengeS256(verifier)` (sha256 + base64url)
- Add unit test stub `tests/oauth/pkce.test.js`

### Step 1.3 — OAuth service
- Create `src/lib/oauth/services/xai.js` mirroring `internal/auth/xai/xai.go`
- Implement `discoverEndpoints()` (cache `/.well-known/openid-configuration`), `buildAuthorizationUrl({state, verifier})`, `exchangeCode({code, verifier})`, `refreshAccessToken({refreshToken})`
- Implement `decodeIdTokenEmail(idToken)` — base64url decode for `email` claim, no signature verify (mirrors Go behavior)
- All HTTP through `src/lib/network/connectionProxy.js`

### Step 1.4 — Loopback callback handler
- Add `xai` case to existing OAuth loopback handler (mirror claude/codex pattern)
- Bind `127.0.0.1:56121`, path `/callback`, single-shot listener
- On success: persist `{ accessToken, refreshToken, idToken, expiresAt, email }` via existing OAuth DB layer
- On error: surface via existing error channel used by other providers

### CHECKPOINT 1
- `npm run lint` clean
- `npm run build` clean
- Manual discovery + verifier roundtrip via node REPL or temp script

---

## Phase 2 — Provider registry + token refresh

### Step 2.1 — Register provider in shared constants
- Edit `src/shared/constants/providers.js`: add `XAI: 'xai'` to `AI_PROVIDERS`
- Edit same file: add `'xai'` entry to `APIKEY_PROVIDERS`
- Add display metadata: `{ id: 'xai', label: 'xAI Grok', icon: '<existing-icon-path>', authModes: ['oauth', 'apikey'] }`
- Update any provider-list exports consumed by dashboard

### Step 2.2 — Wire OAuth provider list
- Edit `src/lib/oauth/providers.js`: register `xai` with `service: require('./services/xai')`, `redirectUri`, `loopbackPort: 56121`
- Ensure provider entry exposes `connect`, `refresh`, `revoke` (revoke = local row delete; xAI has no documented revoke endpoint — mirror CLIProxyAPI behavior of local-only revoke)
- Confirm OAuth UI dispatcher resolves `xai` to the new service

### Step 2.3 — Token refresh loop
- Mirror CLIProxyAPI `refreshLeadTime` (5 min before expiry)
- Hook xAI into existing token refresh scheduler used by claude/codex/gemini
- On refresh failure (401/invalid_grant): mark account as `needs_reauth`, do not retry until user re-connects
- Surface `email` from id_token decode at row write time

### Step 2.4 — Provider normalization
- Edit `src/lib/providerNormalization.js`: add `xai` branch returning `{ baseUrl: XAI_API_BASE, authHeader: 'Authorization', authScheme: 'Bearer' }`
- Ensure model id passthrough for `grok-*` (no rewriting; xAI accepts the literal model id)
- Add helper `isXaiModel(modelId)` matching `/^grok[-_]/i`

### CHECKPOINT 2
- `npm run lint` clean
- `npm run build` clean
- DB row creation via mock token verified in `tests/`
- Refresh path exercised with stubbed expiry

---

## Phase 3 — Inference executor (responses + chat completions, always-SSE)

### Step 3.1 — Executor skeleton
- Create `src/lib/providers/xai/executor.js` mirroring `internal/runtime/executor/xai_executor.go`
- Export `executeResponses({ request, account, signal })` and `executeChatCompletions({ request, account, signal })`
- Both methods POST to `${XAI_API_BASE}/responses` (xAI uses Responses API as the unified endpoint; chat completions are translated upstream via translator)
- Always send `Accept: text/event-stream`; xAI responds with SSE regardless of `stream` flag

### Step 3.2 — SSE collection + non-stream synthesis
- Implement `collectSseToCompleted(stream)` mirroring CLIProxyAPI behavior
- Track `response.output_item.done` events; on terminal event, synthesize a `response.completed` payload by aggregating output_items, usage, and metadata
- For stream callers: pipe events directly into `src/sse/` writer
- For non-stream callers: await full collection, return synthesized `response.completed` JSON body

### Step 3.3 — Auth + retry semantics
- Resolve auth header: OAuth account → `Bearer <accessToken>`; API key → `Bearer <apiKey>` (same header, different secret)
- On HTTP 401: call refresh once, retry once; on second 401, mark account `needs_reauth` and return error
- Forward `Idempotency-Key` header from incoming request when present (mirrors CLIProxyAPI)
- Forward `User-Agent: <XAI_USER_AGENT>`

### Step 3.4 — Tool surface passthrough
- Allow tool entries of types: `web_search`, `image_generation`, `custom`, `function`, `namespace`, `tool_search` (mirrors CLIProxyAPI)
- Do not validate tool schemas client-side beyond presence of `type`; pass through unchanged
- Ensure structured outputs / json_schema fields pass through untouched
- Reasoning / thinking patcher hook is invoked here (see Phase 7)

### CHECKPOINT 3
- `npm run lint` + `npm run build` clean
- Live `/v1/responses` call against authenticated account returns synthesized `response.completed` for non-stream
- Live `/v1/responses` with `stream: true` produces normalized SSE through `src/sse/`
- 401 → refresh → retry verified with stubbed token expiry

---

## Phase 4 — Translators (OpenAI Chat / OpenAI Responses / Claude / Gemini → xAI)

### Step 4.1 — OpenAI Chat Completions ↔ xAI Responses
- Create `src/lib/providers/xai/translators/openai-chat.js`
- Mirror `internal/translator/openai/xai/` directional pair
- Implement `chatRequestToXaiResponses(req)`: messages[] → input[], system → instructions, tools mapping, response_format passthrough
- Implement `xaiEventsToChatStream(events)` and `xaiCompletedToChatJson(completed)` for response normalization

### Step 4.2 — OpenAI Responses ↔ xAI Responses
- Create `src/lib/providers/xai/translators/openai-responses.js`
- Mirror `internal/translator/openai-responses/xai/`
- Mostly passthrough with field-name reconciliation (xAI is Responses-API-shaped already)
- Normalize `output_item` ids and `response.id` per CLIProxyAPI rules

### Step 4.3 — Claude Messages ↔ xAI Responses
- Create `src/lib/providers/xai/translators/claude.js`
- Mirror `internal/translator/claude/xai/`
- Convert `messages[].content` blocks (text/image/tool_use/tool_result) → xAI `input` blocks
- Convert xAI `response.completed` + stream events back to Claude `message_start`/`content_block_*`/`message_delta`/`message_stop` SSE frames

### Step 4.4 — Gemini → xAI Responses
- Create `src/lib/providers/xai/translators/gemini.js`
- Mirror `internal/translator/gemini/xai/`
- `contents[]` (parts: text/inlineData/functionCall/functionResponse) → xAI `input` blocks
- xAI events → Gemini `streamGenerateContent` chunks (`candidates[].content.parts[]`, `usageMetadata`)

### CHECKPOINT 4
- `npm run lint` + `npm run build` clean
- Snapshot tests in `tests/translators/xai/` for each direction (request + response, stream + non-stream)
- Wire selection in `/v1/{chat/completions,responses,messages}/route.js` based on inbound shape

---

## Phase 5 — Image endpoints

### Step 5.1 — Images executor
- Create `src/lib/providers/xai/images.js` mirroring image branches of `xai_executor.go`
- Export `imagesGenerate({ request, account })` → POST `${XAI_API_BASE}/images/generations`
- Export `imagesEdit({ request, account })` → POST `${XAI_API_BASE}/images/edits` (multipart)
- Reuse auth + 401 retry logic from `executor.js`

### Step 5.2 — Multipart handling for edits
- Use existing multipart helper in 9router (or `form-data` already in deps)
- Forward fields: `image`, `mask`, `prompt`, `model`, `n`, `size`, `response_format`, `user`
- Stream upload directly from incoming request body where possible
- Preserve original Content-Type boundary

### Step 5.3 — Route wiring
- Edit `src/app/api/v1/images/generations/route.js` (create if absent): branch on provider resolution → xAI executor for `grok-*` image models
- Edit `src/app/api/v1/images/edits/route.js` (create if absent): same branching
- Maintain OpenAI-compatible response shape (`data: [{ b64_json | url, revised_prompt }]`)
- Provider selection via existing `providerNormalization.js`

### Step 5.4 — Idempotency + size limits
- Forward `Idempotency-Key` if present
- Enforce upstream size limits via clear 4xx (mirror CLIProxyAPI error mapping)
- No client-side image format conversion; pass bytes through
- Log image request metadata (no payload bytes) to existing observability

### CHECKPOINT 5
- `npm run lint` + `npm run build` clean
- Live image generation against `grok-*` image model returns OpenAI-shaped JSON
- Edit endpoint roundtrip with sample PNG + mask

---

## Phase 6 — Video endpoints

### Step 6.1 — Videos executor
- Create `src/lib/providers/xai/videos.js` mirroring video branches of `xai_executor.go`
- Export `videosGenerate(req, account)` → POST `${XAI_API_BASE}/videos/generations`
- Export `videosEdit(req, account)` → POST `${XAI_API_BASE}/videos/edits` (multipart)
- Export `videosExtend(req, account)` → POST `${XAI_API_BASE}/videos/extensions`

### Step 6.2 — Video status polling
- Export `videosGet({ id, account })` → GET `${XAI_API_BASE}/videos/{id}`
- Return upstream JSON unchanged (CLIProxyAPI does not synthesize completion locally)
- Reuse 401 → refresh → retry once
- Forward `Idempotency-Key` on POSTs

### Step 6.3 — Route wiring
- Create `src/app/api/v1/videos/generations/route.js`
- Create `src/app/api/v1/videos/edits/route.js`
- Create `src/app/api/v1/videos/extensions/route.js`
- Create `src/app/api/v1/videos/[id]/route.js` (GET)

### Step 6.4 — Multipart + size handling
- Reuse multipart helper from images
- Stream large video uploads via Web Streams; do not buffer entire payload in memory
- Surface upstream 4xx unchanged with safe redaction of secrets in logs
- Document model id naming for video models in `docs/`

### CHECKPOINT 6
- `npm run lint` + `npm run build` clean
- Live `videos/generations` returns job id; `videos/{id}` polls to completion
- Edit + extension endpoints exercised with sample asset
- Error path (invalid id, 404) returns clean OpenAI-shaped error

---

## Phase 7 — Thinking / reasoning patcher

### Step 7.1 — Patcher module
- Create `src/lib/providers/xai/thinking.js` mirroring `internal/thinking/provider/xai/apply.go`
- Export `applyThinking(request, options)` mutating `request.reasoning` (or equivalent xAI field) per CLIProxyAPI rules
- Map common inbound fields: `reasoning_effort`, `thinking.budget_tokens`, Gemini `thinkingConfig` → xAI shape
- No-op when caller already specifies xAI-native reasoning fields

### Step 7.2 — Wiring into executor
- Call `applyThinking()` inside `executor.js` just before sending to xAI
- Do NOT mutate the original caller request object; clone first
- Preserve passthrough for unknown reasoning fields
- Unit-test mapping table in `tests/providers/xai/thinking.test.js`

### Step 7.3 — Translator integration
- Each translator (Claude, Gemini, OpenAI Chat, OpenAI Responses) calls `applyThinking()` after format conversion
- Single source of truth for budget mapping lives in `thinking.js`
- Document supported budget ranges per model family in JSDoc
- Surface invalid budget as OpenAI-shaped 400

### Step 7.4 — Defaults policy
- Mirror CLIProxyAPI defaults exactly (no proactive enabling of reasoning when caller omits)
- Honor explicit `reasoning: { effort: 'minimal' | 'low' | 'medium' | 'high' }` per OpenAI Responses spec
- Honor Anthropic `thinking: { type: 'enabled', budget_tokens: N }`
- Honor Gemini `thinkingConfig: { thinkingBudget: N }`

### CHECKPOINT 7
- `npm run lint` + `npm run build` clean
- Unit tests cover every inbound→xAI reasoning mapping
- Live request with `reasoning_effort: 'high'` produces non-empty reasoning output
- No regression on requests that omit reasoning fields

---

## Phase 8 — Dashboard UX + CLI login command

### Step 8.1 — Provider card on dashboard
- Provider grid auto-renders from `src/shared/constants/providers.js`; verify xAI card appears with label and icon
- Add icon asset under `public/providers/xai.svg` (or reuse existing if available)
- Wire "Connect" button to OAuth dispatcher (already handled via `src/lib/oauth/providers.js`)
- Add "Add API key" tab on the same card (mirror Anthropic / OpenAI key flow)

### Step 8.2 — Account list rendering
- Show connected xAI accounts with email (from id_token) and `expires_at` countdown
- Surface `needs_reauth` state with re-connect CTA
- Allow API-key entries to coexist with OAuth entries on the same provider
- Reuse existing account-row component used by claude/codex/gemini

### Step 8.3 — CLI login command
- Create `cli/commands/xai-login.js` mirroring `internal/cmd/xai_login.go`
- Spawn loopback server on `127.0.0.1:56121/callback`, open browser to authorization URL
- On callback, exchange code, persist tokens via the same DB layer used by the dashboard
- Print account email + token TTL on success

### Step 8.4 — CLI command registration + docs
- Register `xai-login` in `cli/index.js` command map
- Add `--api-key` subcommand or flag for API-key persistence (mirrors CLIProxyAPI option)
- Update `README.md` and `docs/` with xAI section (auth modes, supported models, endpoints)
- Add troubleshooting note: port 56121 must be free, browser must reach `auth.x.ai`

### CHECKPOINT 8
- `npm run lint` + `npm run build` clean
- `node cli/index.js xai-login` end-to-end produces a usable account row
- Dashboard shows the same row immediately on refresh
- API-key path persists and authenticates without OAuth round-trip

---

## Phase 9 — Tests + verification

### Step 9.1 — Unit tests
- `tests/oauth/xai.test.js` — discovery cache, exchange, refresh, id_token email decode
- `tests/providers/xai/thinking.test.js` — reasoning mapping table
- `tests/providers/xai/translators/*.test.js` — one file per direction (request + response, stream + non-stream)
- `tests/providers/xai/sse-collect.test.js` — `output_item.done` → `response.completed` synthesis

### Step 9.2 — Integration tests
- `tests/integration/xai-responses.test.js` — `/v1/responses` stream + non-stream against mock SSE server
- `tests/integration/xai-chat-completions.test.js` — `/v1/chat/completions` via translator
- `tests/integration/xai-messages.test.js` — `/v1/messages` (Claude shape) via translator
- `tests/integration/xai-images.test.js` — generations + edits against mock

### Step 9.3 — End-to-end verification
- Live OAuth flow via `cli/index.js xai-login` with real account
- Live `/v1/chat/completions` with `model: 'grok-4'` (stream + non-stream)
- Live `/v1/responses` with `reasoning_effort: 'high'`
- Live `/v1/images/generations` and one `/v1/videos/generations` + `videos/{id}` poll

### Step 9.4 — Regression sweep
- Re-run existing test suites for claude, codex, gemini, qwen, kiro to confirm no shared-module regressions
- Confirm `src/sse/` and `open-sse/` behavior unchanged for non-xAI providers
- Snapshot-compare translator outputs against CLIProxyAPI reference fixtures (copy a small set into `tests/fixtures/xai/`)
- Run `npm run lint` and `npm run build` once more on a clean checkout

### CHECKPOINT 9
- All unit + integration tests green
- All four live e2e flows pass against a real xAI account
- No regressions in other providers
- `npm run build` succeeds with zero warnings introduced by xAI code

---

## File Inventory

### Created (absolute paths)

- `/Users/mugnihadi/personal/9router/src/lib/oauth/constants/xai.js`
- `/Users/mugnihadi/personal/9router/src/lib/oauth/services/xai.js`
- `/Users/mugnihadi/personal/9router/src/lib/oauth/utils/pkce.js` (only if not already present)
- `/Users/mugnihadi/personal/9router/src/lib/providers/xai/executor.js`
- `/Users/mugnihadi/personal/9router/src/lib/providers/xai/images.js`
- `/Users/mugnihadi/personal/9router/src/lib/providers/xai/videos.js`
- `/Users/mugnihadi/personal/9router/src/lib/providers/xai/thinking.js`
- `/Users/mugnihadi/personal/9router/src/lib/providers/xai/translators/openai-chat.js`
- `/Users/mugnihadi/personal/9router/src/lib/providers/xai/translators/openai-responses.js`
- `/Users/mugnihadi/personal/9router/src/lib/providers/xai/translators/claude.js`
- `/Users/mugnihadi/personal/9router/src/lib/providers/xai/translators/gemini.js`
- `/Users/mugnihadi/personal/9router/src/app/api/v1/videos/generations/route.js`
- `/Users/mugnihadi/personal/9router/src/app/api/v1/videos/edits/route.js`
- `/Users/mugnihadi/personal/9router/src/app/api/v1/videos/extensions/route.js`
- `/Users/mugnihadi/personal/9router/src/app/api/v1/videos/[id]/route.js`
- `/Users/mugnihadi/personal/9router/cli/commands/xai-login.js`
- `/Users/mugnihadi/personal/9router/public/providers/xai.svg` (if no existing icon)
- `/Users/mugnihadi/personal/9router/tests/oauth/xai.test.js`
- `/Users/mugnihadi/personal/9router/tests/providers/xai/thinking.test.js`
- `/Users/mugnihadi/personal/9router/tests/providers/xai/sse-collect.test.js`
- `/Users/mugnihadi/personal/9router/tests/providers/xai/translators/openai-chat.test.js`
- `/Users/mugnihadi/personal/9router/tests/providers/xai/translators/openai-responses.test.js`
- `/Users/mugnihadi/personal/9router/tests/providers/xai/translators/claude.test.js`
- `/Users/mugnihadi/personal/9router/tests/providers/xai/translators/gemini.test.js`
- `/Users/mugnihadi/personal/9router/tests/integration/xai-responses.test.js`
- `/Users/mugnihadi/personal/9router/tests/integration/xai-chat-completions.test.js`
- `/Users/mugnihadi/personal/9router/tests/integration/xai-messages.test.js`
- `/Users/mugnihadi/personal/9router/tests/integration/xai-images.test.js`
- `/Users/mugnihadi/personal/9router/tests/fixtures/xai/` (CLIProxyAPI reference fixtures)

### Modified (absolute paths)

- `/Users/mugnihadi/personal/9router/src/shared/constants/providers.js` — add `xai` to `AI_PROVIDERS` + `APIKEY_PROVIDERS` + display metadata
- `/Users/mugnihadi/personal/9router/src/lib/oauth/providers.js` — register xai service + redirect + loopback port
- `/Users/mugnihadi/personal/9router/src/lib/providerNormalization.js` — xai branch for base URL + auth scheme + model id detection
- `/Users/mugnihadi/personal/9router/src/app/api/v1/responses/route.js` — provider branch for xai
- `/Users/mugnihadi/personal/9router/src/app/api/v1/chat/completions/route.js` — provider branch for xai (via openai-chat translator)
- `/Users/mugnihadi/personal/9router/src/app/api/v1/messages/route.js` — provider branch for xai (via claude translator)
- `/Users/mugnihadi/personal/9router/src/app/api/v1/images/generations/route.js` — provider branch for xai (create file if absent)
- `/Users/mugnihadi/personal/9router/src/app/api/v1/images/edits/route.js` — provider branch for xai (create file if absent)
- `/Users/mugnihadi/personal/9router/cli/index.js` — register `xai-login` command
- `/Users/mugnihadi/personal/9router/README.md` — xAI section
- `/Users/mugnihadi/personal/9router/docs/` — provider doc page for xAI

### Untouched (must not regress)

- `/Users/mugnihadi/personal/9router/src/sse/`
- `/Users/mugnihadi/personal/9router/open-sse/`
- `/Users/mugnihadi/personal/9router/src/lib/network/connectionProxy.js`
- `/Users/mugnihadi/personal/9router/src/lib/db/`
- All other provider services (`claude.js`, `codex.js`, `gemini.js`, `qwen.js`, `kiro.js`)

---

## Risks

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | xAI Responses API is always-SSE; non-stream callers expect plain JSON | High | High | Implement `collectSseToCompleted()` mirroring CLIProxyAPI; aggregate `response.output_item.done` into synthesized `response.completed`; covered by `tests/providers/xai/sse-collect.test.js` |
| R2 | Translator surface is large (~16 directional pairs across 4 inbound formats) | High | Medium | Split into 4 translator files, one per inbound format; snapshot-test each direction against fixtures copied from CLIProxyAPI |
| R3 | id_token JWT decode for email surfacing may misparse on edge cases | Medium | Low | Decode only — no signature verify (mirrors Go); base64url-safe with padding fallback; treat missing `email` as null, not error |
| R4 | 401 handling could loop on a permanently invalid refresh token | Medium | Medium | Single retry only; on second 401 mark account `needs_reauth` and stop; same policy as claude/codex |
| R5 | Loopback port 56121 may be in use | Low | Low | Detect EADDRINUSE, surface clear error in CLI + dashboard; document in troubleshooting |
| R6 | Tool-type passthrough may include unknown future types | Low | Low | Pass tools through unchanged when `type` field present; xAI rejects invalid types upstream with proper errors |
| R7 | Multipart streaming for image/video edits could buffer large payloads | Medium | Medium | Use Web Streams; do not read body into memory; document upstream size limits |
| R8 | Reasoning/thinking budget mapping diverges across model families | Medium | Medium | Centralize in `thinking.js`; document supported budgets in JSDoc; unit-test the mapping table |
| R9 | xAI API base URL or constants change upstream | Low | High | Constants live in one file; track CLIProxyAPI commits referenced in this plan |
| R10 | Shared SSE pipeline regressions affect other providers | Low | High | Phase 9 regression sweep re-runs claude/codex/gemini/qwen/kiro tests |

---

## Verification Strategy

### Per-phase

- After every phase: `npm run lint` and `npm run build` must succeed
- Phase-specific tests (listed in each CHECKPOINT block) must pass before moving on
- Manual smoke test described in each CHECKPOINT must succeed

### Functional (e2e)

- CLI login: `node cli/index.js xai-login` produces a connected account row with email and TTL
- Dashboard: provider card shows xAI with both "Connect (OAuth)" and "Add API key" actions; account list reflects changes immediately
- Chat: `POST /v1/chat/completions` with `model: 'grok-4'`, both `stream: true` and `stream: false`
- Responses: `POST /v1/responses` with `reasoning_effort: 'high'`, both stream and non-stream
- Messages (Claude shape): `POST /v1/messages` with translator path
- Images: `POST /v1/images/generations` and `POST /v1/images/edits`
- Videos: `POST /v1/videos/generations` then poll `GET /v1/videos/{id}` to terminal state

### Integration

- Mock SSE server returning a canonical xAI event stream → assert non-stream synthesis matches expected `response.completed` JSON
- Mock 401 once → assert single refresh + retry; mock 401 twice → assert `needs_reauth` flag set, no further retries
- Mock multipart upstream for image/video edits → assert request body bytes preserved

### Regression

- Re-run claude/codex/gemini/qwen/kiro test suites after Phase 9
- Build size delta within tolerance vs. baseline before xAI work
- No new ESLint warnings introduced by xAI code

### Sign-off criteria

1. All CHECKPOINTS 1–9 green
2. All four live e2e flows pass against a real xAI account
3. CLIProxyAPI reference fixtures match (within documented tolerance) for translator outputs
4. No regressions in other providers

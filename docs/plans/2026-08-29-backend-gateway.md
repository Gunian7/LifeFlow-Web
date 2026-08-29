# LifeFlow Backend Gateway Implementation Plan

> **For Hermes:** Execute this plan task-by-task with TDD and verify every deployment claim from real output.

**Goal:** Add a small, stateless backend gateway that supports optional AI ordering without exposing provider keys or storing user tasks.

**Architecture:** `apps/api` is a Hono TypeScript service deployable to Cloudflare Workers. The API validates a narrow request containing only task ids, titles, durations and importance, then asks a configured provider for an order-only suggestion. The service never persists task content. The Web/PWA remains usable offline and locally when the gateway is absent.

**Tech Stack:** Hono, TypeScript, Cloudflare Workers/Wrangler, Vitest, shared `packages/core` types and AI response validation.

---

## Product boundaries

- No login or account system in this phase.
- No task database or task history on the server.
- No API key in browser code or JSON responses.
- AI can suggest order and explanation only; local Planner remains authoritative.
- Request payload excludes notes, place, deadlines and completed history unless a later reviewed contract explicitly adds them.
- Provider failures return a safe error shape; no upstream response body is echoed.

## Task sequence

### Task 1: API package and TypeScript worker scaffold

Create `apps/api/src/index.ts`, `apps/api/src/types.ts`, `apps/api/wrangler.toml`, and API-specific scripts/config. Add Hono and Workers types. Keep the root Web build unaffected.

Verify with `npm test` and `npm run build:api`.

### Task 2: Health endpoint

Write a failing test for `GET /health` returning `{ ok: true, service: "lifeflow-api" }`, then implement it.

Verify with the API test and a local Worker request.

### Task 3: Narrow AI ordering contract

Write failing tests for request validation:

- empty task list rejected;
- task id/title required;
- only allowed fields accepted;
- maximum task count enforced;
- response order must contain each input id exactly once;
- malformed model JSON rejected.

Implement `POST /v1/ai/order` with an injected provider function so tests do not call a network.

### Task 4: Provider adapter

Implement the OpenAI-compatible adapter using a server-side `LLM_API_KEY` and `LLM_BASE_URL`/`LLM_MODEL` Worker bindings. Send only the reviewed fields. Never log key, authorization header, task content, or upstream response body.

### Task 5: Web client integration

Add a user-triggered “AI 建议 · 可选” action to the planner explanation area. Show suggestion and explanation without applying it automatically. If the API is unreachable, keep the local plan and show a non-blocking message.

### Task 6: Deployment configuration

Add a separate GitHub Actions workflow for `apps/api`, document Cloudflare secret setup commands without printing secrets, and deploy only after local tests/build pass. The public API URL must be verified with `curl` and `/health` before reporting deployment success.

## Verification commands

```bash
npm test
npm run build
npm run build:api
npx wrangler dev
curl http://127.0.0.1:8787/health
```

For production, verify:

```bash
curl -fsS https://<api-domain>/health
```

Do not report a deployed backend until the production health response and the GitHub/Cloudflare deployment result both confirm it.

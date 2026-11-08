# Claude Code headless notes (creative director backend)

Fetched 2026-11-08 from code.claude.com / platform.claude.com docs (sources at bottom).

## Recommended invocation

First turn of a brief (one `-p` process per turn; simplest, avoids stdin framing):

```bash
claude -p "<user turn>" \
  --session-id <uuid-v4 generated in Rust> \
  --model claude-opus-5-5 \
  --output-format stream-json --verbose --include-partial-messages \
  --append-system-prompt-file <abs>/prompts/director.md \
  --tools "Read,WebSearch,WebFetch" \
  --allowedTools "Read" "WebSearch" "WebFetch(domain:higgsfield.ai)" "WebFetch(domain:*.higgsfield.ai)" \
  --disallowedTools "Bash" "Edit" "Write" "mcp__*" \
  --permission-mode dontAsk \
  --add-dir <abs>/brief-assets \
  --max-turns 12
```

Later turns: `--resume <same-uuid>` instead of `--session-id`.

## stream-json events (NDJSON on stdout)

- `system/init`: session_id, model, tools[], permissionMode, apiKeySource, claude_code_version…
- `system/api_retry`: attempt, max_retries, retry_delay_ms, error (rate_limit, overloaded, authentication_failed, billing_error).
- `stream_event` (with --include-partial-messages): text deltas at `.event.delta.type=="text_delta"` → `.event.delta.text`.
- `assistant`: full message with content[] blocks. `user`: tool results.
- `result` (last): subtype (success | error_max_turns | error_during_execution | error_max_budget_usd | …), is_error, result, session_id, num_turns, total_cost_usd, usage, permission_denials[], structured_output (with --json-schema).
- `total_cost_usd` is cumulative across resumed runs → per-turn cost = delta.
- Non-zero exit on failure; SIGTERM → 143, turn not recorded (that's our cancel).

## Sessions

- Use `--session-id` then `--resume`. Avoid `--continue` (picks most recent; unsafe with many briefs).
- `--fork-session` with `--resume` branches a brief.
- The system prompt is fixed at the first request; changes to director.md apply to new briefs (or pass `--system-prompt-snapshot off`).
- Don't parse `~/.claude/projects/...jsonl` (internal format).

## System prompt

Use `--append-system-prompt-file` (keeps Claude Code's tool/safety guidance). `--system-prompt[-file]` replaces it.

## Tools / permissions

- `--tools` limits built-in tools; `--disallowedTools "mcp__*"` blocks MCP.
- WebSearch/WebFetch need to be in `--allowedTools`. `WebFetch(domain:x)` exact, `*.x` subdomains only. WebSearch takes no specifier.
- `dontAsk` in -p denies anything not pre-approved. Never use bypassPermissions.
- `--add-dir` makes attachment folder readable.

## Attachments

- Option A (chosen): put absolute paths in the prompt; Read returns PNG/JPEG/GIF/WebP as visual content.
- Option B: stream-json image blocks (base64) via `--input-format stream-json`. Stdin schema UNVERIFIED.
- Video references: Claude can't watch video. Extract a few keyframes with ffmpeg and attach those.

## Structured hand-off

`--json-schema '<schema>'` → `result.structured_output` (validated). Partial-stream JSON deltas are not validated. We'll still validate against the model schema in Rust.

## Detection

- `claude --version`: binary present, no API call.
- `claude auth status`: JSON, exit 0 logged in / 1 not; `authMethod` field.

## Anthropic API fallback

- Models: claude-opus-5-5 ($4/$20 per MTok), claude-sonnet-5-5 ($2/$10), claude-haiku-5-5, claude-fable-5-1.
- Web search tool: `{"type":"web_search_20260318","name":"web_search","max_uses":5,"allowed_callers":["direct"]}`, $10/1k searches.
- SSE streaming; image blocks base64, images before text.

## Unverified

- CLI stdin schema for `--input-format stream-json`.
- Whether `--json-schema` changes the stream-json `result` shape (it's documented with `--output-format json`).
- Exact wire casing of `system/init` fields.
- Whether `claude auth status` uses any quota (believed local-only).
- Direct-API per-image size limit.

## Sources

headless.md, cli-reference.md, sessions.md, permission-modes.md, permissions.md, tools-reference.md, agent-sdk/{typescript,python,streaming-output,streaming-vs-single-mode}.md (code.claude.com/docs/en/); platform.claude.com models/overview, web-search-tool, vision, streaming.

# OpenCode ACP Smoke Test — Findings (T0.1, #16)

## Conclusion

**The OpenCode ACP path is viable.** Driving `opencode acp` over stdio via
`@agentclientprotocol/sdk`, as already implemented in
`packages/agent-runtime/src/index.ts` (`OpenCodeExecutor`) and
`acp-client.ts` (`launchAcpProcess`), works end-to-end against the real
`opencode` binary — not just the in-memory fake agent used by
`index.test.ts`.

## How this was verified

`packages/agent-runtime/src/smoke/opencode-acp-smoke.ts` is a manual smoke
script (not part of `pnpm test`, since it needs a real `opencode` install
with configured model credentials). Run it with:

```bash
pnpm --filter @agentdock/agent-runtime run smoke:acp
```

It exercises `OpenCodeExecutor` exactly as production code does, covering
every acceptance criterion from the issue:

| Criterion | Result |
| --- | --- |
| Node can launch OpenCode ACP | ✅ real subprocess spawn, JSON-RPC over stdio |
| `workspaceCwd` can be specified | ✅ `canRun()` + session bound to the temp workspace |
| Submit a simple prompt | ✅ "reply with pong" round-trip |
| Structured progress received | ✅ `status('running')` + `log()` events from `session/update` |
| Final structured result received | ✅ `ExecutorRunResult.status === 'succeeded'` |
| Run can be cancelled | ✅ `cancel()` sends `session/cancel`; run resolves as `cancelled` |
| No TUI stdout parser | ✅ structurally guaranteed — `acp-client.ts` never reads `child.stdout` directly, only the ndjson ACP stream |

## Issue found and fixed along the way

`launchAcpProcess` (`acp-client.ts`) called `child_process.spawn('opencode', ...)`
directly. On Windows, npm/pnpm-installed CLIs are `.cmd`/`.bat` shims, which
`spawn` cannot exec without a shell — this failed with `ENOENT` (bare
`opencode`) or `EINVAL` (explicit `opencode.cmd` path without `shell: true`).
Fixed by passing `shell: process.platform === 'win32'` to `spawn`, matching
Node's documented guidance for spawning `.bat`/`.cmd` files on Windows.
`command`/`args` originate from local executor config
(`OpenCodeExecutorOptions`), not untrusted input, so enabling the shell here
does not introduce an injection risk. Covered by
`packages/agent-runtime/src/acp-client.test.ts`.

## Notes for follow-up work

- `opencode acp` has no `--model` CLI flag; model selection happens inside
  the ACP session using whatever default provider/model is configured
  locally (`opencode providers login`). Callers needing a specific model
  should do so via session/prompt parameters once the ACP SDK exposes that,
  not via CLI args.
- Fast/free models can finish an entire turn in well under a second, so
  tests exercising `cancel()` should trigger cancellation reactively (e.g.
  on the first observed progress event) rather than racing a fixed delay.

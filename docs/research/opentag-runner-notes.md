# OpenTag Runner Source Reading — Findings (T0.3, #18)

## Scope and source snapshot

Read directly from `https://github.com/amplifthq/opentag`, package
`@opentag/runner` ("Executor contracts and built-in runner adapters for
OpenTag"), at commit `491dd79fd9e53e1813e9299e33ecba6cdd85b801`
(tag `v0.11.0`, merged 2026-08-17). Files read in full:

- `packages/runner/src/index.ts` — package export surface
- `packages/runner/src/executor.ts` — `ExecutorAdapter` contract, run input/output types
- `packages/runner/src/acp-agent.ts` — generic ACP agent definition → executor factory
- `packages/runner/src/builtin-acp.ts` — the six built-in ACP agent definitions
- `packages/runner/src/acp-executor.ts` — the actual ACP host (spawn, protocol, cancel, permissions)
- `packages/runner/src/git.ts` — worktree/branch/commit helpers used by the ACP host
- `packages/runner/src/command.ts` — child-process runner abstraction

**Important correction to `docs/tasks.md` T0.3's caveat:** the previous note
said `createAcpAgentExecutor` / `createBuiltInAcpExecutors` / "built-in ACP
agent definitions" were *assumed* names, not confirmed from source. Having
now read the source directly, **these are the real, exported API names**,
unchanged from the guess:

- `createAcpAgentExecutor(definition, options)` — `acp-agent.ts`
- `createBuiltInAcpExecutors(options)` — `builtin-acp.ts`
- `builtInAcpAgentDefinitions(options)` and `builtInAcpAgentManifests(options)` — `builtin-acp.ts`
- `createAcpExecutor(options)` — `acp-executor.ts` (the lower-level primitive both of the above build on)

This is worth tracking as circumstantial evidence only — OpenTag is
pre-1.0 and these names could still change in a later release; re-check
before depending on them in `packages/agent-runtime`.

## 1. Built-in ACP agent definitions

`builtin-acp.ts` defines exactly six built-ins, matching the README's "Six
built-in executors" claim:

| id | label | launch command | registry pin | readiness timeout | supportsCancel |
| --- | --- | --- | --- | --- | --- |
| `codex` | Codex ACP | `npx --yes @agentclientprotocol/codex-acp@1.1.2` | `codex-acp@1.1.2` | 30s | true |
| `claude-code` | Claude Agent ACP | `npx --yes @agentclientprotocol/claude-agent-acp@0.59.0` | `claude-acp@0.59.0` | 30s | true (sessionModeId `"default"`) |
| `cursor` | Cursor ACP | `cursor-agent acp` | — (relies on local install) | 30s | true |
| `opencode` | OpenCode ACP | `npx --yes opencode-ai@1.18.1 acp` | `opencode@1.18.1` | 30s | true |
| `hermes` | Hermes ACP | `<hermesCommand> -p <profile> acp` (command/profile configurable, default profile from `hermes-profile.ts`) | — | 60s | true, `supportsProfile: true` |
| `openclaw` | OpenClaw ACP | `<openclawCommand> [--profile p] acp [--url gatewayUrl]`, with a `preflight` from `openclaw-preflight.ts` | — | 30s | **false** — README: "cancellation is currently best effort" |

Notable: the `opencode` built-in sets
`launchEnvironment: { OPENCODE_DISABLE_TERMINAL_TITLE: "true", OPENCODE_PURE: "true" }`
— i.e. OpenTag always launches OpenCode in **pure ACP mode** (no external
plugins), unlike AgentDock's current `OpenCodeExecutor`, which does not pass
`--pure`/`OPENCODE_PURE` and therefore allows plugins such as
`oh-my-opencode-slim` to load by default (see T0.2/#17 notes). This is a
concrete, source-confirmed design divergence worth flagging if AgentDock
later wants a "guaranteed no external plugin" mode — OpenTag's approach
(env var forced on for this one built-in) is the closest prior art.

Every definition has `workspaceCwd: "required"` (type-level, via
`AcpAgentDefinition`), i.e. an explicit repo/scratch working directory is
mandatory for all six — there is no "no cwd" ACP agent.

`builtInAcpAgentManifests()` derives an `OpenTagIntegrationManifest` per
built-in via `createAcpAgentManifest()`, and `createBuiltInAcpExecutors()`
derives the six `ExecutorAdapter`s via `createAcpAgentExecutor()`. Both are
just `Record<BuiltInAcpAgentId, X>` built by mapping over
`builtInAcpAgentDefinitions()` — there is no separate registry/lookup
abstraction beyond the plain object/record.

## 2. ACP executor factory / abstraction

Three layers, from generic to specific:

1. **`createAcpExecutor(options: AcpExecutorOptions): ExecutorAdapter`**
   (`acp-executor.ts`) — the actual engine. Takes a raw
   `OpenTagIntegrationManifestInput` (parsed via
   `OpenTagIntegrationManifestSchema.parse`, requiring a `roles.agent`
   binding), plus `launchEnvironment`, `preflight`, `permissionResolver`,
   `runner` (command runner, defaults to `nodeCommandRunner`),
   `cancelGraceMs`, `readinessTimeoutMs`, `sessionModeId`,
   `capabilityOverrides` (`supportsProfile`/`supportsCancel`), `security`.
   Returns an `ExecutorAdapter` with `canRun`, `run`, `cancel`.

2. **`createAcpAgentExecutor(definition: AcpAgentDefinition, options): ExecutorAdapter`**
   (`acp-agent.ts`) — a thin adapter over `createAcpExecutor`: builds the
   manifest from a simpler `AcpAgentDefinition` (`id`, `label`, `launch`,
   `registry?`, `preflight?`, `sessionModeId?`, `capabilities?`,
   `launchEnvironment?`, `readinessTimeoutMs?`) via `createAcpAgentManifest`,
   and forwards the rest of the fields into `createAcpExecutor`'s options.

3. **`createBuiltInAcpExecutors(options: BuiltInAcpAgentOptions): Record<BuiltInAcpAgentId, ExecutorAdapter>`**
   (`builtin-acp.ts`) — calls `createAcpAgentExecutor` once per built-in
   definition, sharing `{ security }` across all six if provided.

The `ExecutorAdapter` contract itself (`executor.ts`) is the true
abstraction boundary all executors (ACP or not — `echo.ts` implements the
same interface for dev/test) implement:

```ts
type ExecutorAdapter = {
  id: string;
  displayName: string;
  capability?: ExecutorCapabilityContract;
  canRun(input: ExecutorRunInput): Promise<ExecutorReadiness>;
  run(input: ExecutorRunInput, sink: ExecutorEventSink): Promise<OpenTagRunResult>;
  cancel(runId: string, attemptId?: string): Promise<void>;
};
```

`ExecutorRunInput` carries `runId`, `attemptId?`, `workspace` (repository or
scratch), `command`, `context`/`contextPacket`, `permissions`,
`baseBranch?`, `worktreeRoot?`, `keepWorktree?`, `sessionProfile?`, plus two
callback hooks: `permissionResolver` (governs individual ACP tool-call
permission prompts) and `materialActionReporter` (records durable receipts
for governed/material actions). This is richer than a plain
"spawn + parse stdout" abstraction — permission governance and
material-action bookkeeping are first-class parts of the run contract, not
bolted on separately.

## 3. Workspace cwd conformance

Declared in the capability contract as
`workspaceCwdConformance: "declared"` (i.e. OpenTag asserts, rather than
independently re-verifies at runtime, that the child process's cwd equals
the session cwd it told the ACP agent to use) — this is a real enum value
(`ExecutorWorkspaceCwdConformance = "declared" | "unverified"`), and
`createAcpExecutor`'s returned capability always sets it to `"declared"`.

Mechanically, cwd handling is layered:

- `assertExplicitWorkspace(input)` — workspace must be present and its
  `path` must be **absolute**, or it throws immediately. No implicit
  "current directory" fallback exists.
- `safeAcpCwd(workspacePath, configuredCwd)` — resolves the real (symlink
  free, via `fs.realpath`) workspace path; if the manifest binding declares
  a `cwd` (relative subpath within the workspace), it is resolved with
  `path.resolve` and then checked via `path.relative` that it does **not**
  escape the workspace (`..` or absolute after normalization → throws
  `"ACP binding cwd must stay inside the attempt workspace."`), and must
  resolve to a real directory (`fs.stat(...).isDirectory()`).
- For `workspace.kind === "repository"`, the child never runs at the
  original workspace path — `executionPathForAttempt()` (from `git.ts`)
  computes a **worktree path** (`<workspaceRoot>/.worktrees/opentag/<runId>`
  by default, or under a custom `worktreeRoot`), and `createRunWorktree()`
  runs `git worktree add -B <branch> <worktreePath> <baseBranch>` before the
  child is spawned there. This mirrors AgentDock's own `WorktreeManager`
  design (isolation per run/attempt on a dedicated branch), but the branch
  name derivation is different: `branchNameForRun(id)` sanitizes the run/
  attempt-composite id and always prefixes it with `opentag/` (e.g.
  `opentag/run-42-attempt-7`).
- `canRun()` also cwd-checks eagerly: for a repository workspace it runs
  `git rev-parse --show-toplevel` (must succeed) and
  `git rev-parse --verify <baseBranch>^{commit}` (base branch must exist)
  *before* even calling `safeAcpCwd`, so a broken checkout or missing base
  branch fails readiness rather than failing mid-run.
- The child process is always spawned with `cwd: childCwd` (the resolved,
  worktree-relative real path) — never the manifest's raw string, never the
  process's own `process.cwd()`.

## 4. Progress

Progress is a `capability.progressEvents: "audit"` contract — OpenTag's own
type union is `ExecutorProgressEventMode = "none" | "audit" | "human"`, and
every ACP executor built via `createAcpExecutor` reports `"audit"` (i.e.
progress goes into the durable local audit ledger, not directly rendered to
the human thread as a first-class UX — matches the README's description of
"a local agent work ledger" separate from the human-facing reply).

Concretely, progress is emitted as `ExecutorEvent` objects
(`{ type: "executor.started" | "executor.progress" | "executor.completed" | "executor.failed"; message: string; at: string }`)
via an `ExecutorEventSink.emit()` passed into `run()`. Emission points:

- `executor.started` — right before worktree creation (repository
  workspace) or right before spawning the child (scratch workspace).
- `executor.progress` — from `emitSessionUpdate()`, translating every ACP
  `session/update` notification into a message:
  - `agent_message_chunk` (text) → the raw chunk text is both emitted as
    progress **and** accumulated into an `output` buffer used for the
    final result summary.
  - `tool_call` → `"Tool: <safeToolTitle> (<status>)"`.
  - `tool_call_update` → `"Tool <toolCallId> updated (<status>)"`.
  - `plan` → `"Plan: <entries joined by '; '>"`.
  - Also used ad hoc for informational notices (e.g. cleaned internal
    artifacts, governed-action reconciliation skips, worktree cleanup
    failures).
- `executor.completed` / `executor.failed` — once at the very end of `run()`,
  chosen by whether the derived `result.conclusion === "success"`.

All tool-call titles are passed through `safeToolTitle()` (control-character
stripping + 160-char cap + credential-safety check via `@opentag/core`'s
`isCredentialSafeText`) before ever reaching a sink — progress messages are
credential-redacted by construction, not as an afterthought.

## 5. Cancellation

`cancel(runId, attemptId?)` on the returned `ExecutorAdapter`:

1. Looks up the `ActiveRun` record by `activeRunKey(runId, attemptId)` (or,
   if no `attemptId` given, the first active run matching `runId` — a
   legacy/looser lookup path). No-ops if nothing is active.
2. Sets `active.cancelRequested = true` unconditionally (checked at several
   points inside `run()`'s control flow — before worktree creation, before
   spawning, and inside the per-session prompt loop — so a cancel requested
   before the child even spawns still short-circuits cleanly via
   `stopResult({ stopReason: "cancelled", ... })`).
3. If a live ACP `client`/`sessionId` exists, sends the *protocol-level*
   cancellation: `client.notify(acp.methods.agent.session.cancel, { sessionId })`,
   bounded by `waitForSettled(..., cancelGraceMs)` (default
   `DEFAULT_CANCEL_GRACE_MS = 1_000`ms) so a hung notify can't block
   cancellation forever.
4. Regardless of whether the notify succeeded, **always** forcibly
   terminates the child via `terminateActiveChild()` → `terminateChild()`:
   - closes stdin,
   - POSIX: waits for the whole **process group** to exit
     (`waitForProcessTreeExit`, using `process.kill(-pid, 0)` liveness
     probing — not just the direct child), else `SIGTERM` to the group,
     waits again, else `SIGKILL` to the group, waits again.
   - Windows: shells out to `taskkill /PID <pid> /T /F` (via the injected
     `CommandRunner`, so it's testable), falling back to `child.kill("SIGKILL")`
     if `taskkill` itself failed to invoke.
   - Returns a `boolean` "confirmed terminated" flag, memoized on the
     `ActiveRun` via a single shared `terminationPromise` (so concurrent
     callers — e.g. `run()`'s own `finally` and an external `cancel()` call
     racing each other — converge on one real termination attempt, not two).
5. The **reported outcome** distinguishes "ACP accepted cancellation" from
   "OpenTag confirmed the whole process tree actually exited": in
   `stopResult()`, a `cancelled` stop reason without a confirmed termination
   yields conclusion `"cancelled"` but with the caveat message *"...
   provider-owned tool subprocess termination is not confirmed"* and a
   `nextAction` telling the caller to inspect provider-owned processes
   before starting a new Attempt — this is exactly the OpenClaw caveat the
   README calls out ("cancellation is currently best effort") made
   structural: `supportsCancel: false` for `openclaw` means
   `cancelTerminationConfirmed` is forced `false` in every `stopResult()`
   call regardless of what actually happened to the child.

Cancellation therefore is: ACP-level cooperative notify (best effort) +
OS-level forced process-**tree** kill (authoritative), with the executor
never claiming a stronger guarantee (tree confirmed dead) than what it
actually observed.

## 6. Readiness

Two distinct readiness concepts:

**a) `canRun(input): Promise<ExecutorReadiness>`** — pre-flight check called
by the caller before starting a run, `{ ready: boolean; reason?: string }`.
For a `createAcpExecutor`-built adapter, in order:
1. Validate the workspace (`assertExplicitWorkspace`) — absolute path.
2. If `repository` workspace: `git rev-parse --show-toplevel` succeeds, and
   the configured `baseBranch` (default `"main"`) resolves via
   `git rev-parse --verify <base>^{commit}`.
3. Resolve/validate cwd via `safeAcpCwd` (see §3).
4. Run the adapter's own `preflight()` if supplied (e.g. OpenClaw's
   Gateway-version/URL check in `openclaw-preflight.ts`) — any thrown error
   is swallowed and turned into a generic
   `"ACP provider compatibility preflight failed for <id>."` reason rather
   than leaking the raw error.
5. Only after all of the above pass, call `probeAcpInitialization()` — this
   actually **spawns the real ACP child** (with a `readinessTimeoutMs`
   budget — 3s default, but 30s/60s per built-in, see the table in §1),
   performs the ACP `initialize` handshake (`agent.initialize` request,
   checks the negotiated `protocolVersion` matches `acp.PROTOCOL_VERSION`),
   and then unconditionally terminates that probe child in a `finally`
   block — i.e. readiness genuinely round-trips the ACP handshake with a
   disposable process rather than only checking that a binary/command
   exists on `PATH`. Failure reasons are structured diagnostics:
   `spawnCode=<errno>`, `detail=<redacted message>`, `stderr=<redacted, ≤16KB>`.

**b) `readinessTimeoutMs` per built-in** (§1 table) — this is the timeout
budget for step 5 above, tuned per agent (Hermes gets 60s vs. the 30s used
by the npx-launched agents, presumably because Hermes's own startup is
slower).

There is no separate persistent "readiness/health" polling loop in this
package — readiness is a one-shot check invoked by the caller (presumably
`@opentag/local-runtime`, not read as part of this spike) immediately before
dispatching a run, not a background heartbeat.

## Summary for AgentDock's `packages/agent-runtime`

Points directly comparable to AgentDock's existing `OpenCodeExecutor` /
`launchAcpProcess` (`packages/agent-runtime/src/index.ts`, `acp-client.ts`):

- Both drive ACP purely over stdio ndjson — AgentDock's is not "behind" the
  reference implementation architecturally.
- OpenTag forces `opencode acp` into pure mode (`OPENCODE_PURE=true`) for
  its `opencode` built-in; AgentDock currently does not. This is the same
  gap the OMO Slim compatibility note (#17) already flagged as a known
  limitation (no first-class switch for `--pure`) — OpenTag's env-var
  approach is a viable, low-effort model to copy if/when AgentDock adds
  that switch.
- OpenTag's cancellation model (cooperative ACP notify with a short grace
  period, then unconditional OS-level process-**group** kill, with explicit
  tracking of whether tree-exit was actually confirmed) is more defensive
  than a bare `cancel()` that only sends the ACP notify — worth using as a
  reference if AgentDock's own cancellation path needs hardening beyond
  what `docs/tasks.md`/`#27` already covers for worktree push safety.
- OpenTag's readiness probe (spawn a disposable child, do the full ACP
  `initialize` handshake, then kill it) is a stronger and more expensive
  check than a `command -v`/`which` existence check — a pattern worth
  reusing if AgentDock ever needs a pre-flight "is this executor usable
  right now" signal (e.g. surfaced in the Web console before a user selects
  an executor for a project).

No code changes to AgentDock followed from this reading — this is a
research/spike deliverable only (T0.3), matching the issue's scope.

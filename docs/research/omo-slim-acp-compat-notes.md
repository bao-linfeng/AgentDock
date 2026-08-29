# OMO Slim (oh-my-opencode-slim) ACP Compatibility — Findings (T0.2, #17)

## Conclusion

**`compatible_with_limitations`.**

`oh-my-opencode-slim` (OMO Slim) works when OpenCode is driven purely over
ACP — the same `OpenCodeExecutor` / `launchAcpProcess` code path already
used in production (`packages/agent-runtime/src/index.ts`, `acp-client.ts`)
loads the plugin, runs its orchestrator, delegates to specialist sub-agents,
and can be cancelled reliably, all observable as structured ACP
`session/update` events — no TUI stdout parsing involved. The "limitations"
are two known constraints to track, not blockers (see below); MVP does not
need a fallback to pure OpenCode ACP.

## How this was verified

`packages/agent-runtime/src/smoke/omo-slim-acp-smoke.ts` is a manual smoke
script (not part of `pnpm test`, since it needs a real `opencode` install
with configured model credentials and network access to fetch the plugin).
Run it with:

```bash
pnpm --filter @agentdock/agent-runtime run smoke:omo-slim
```

It isolates the check from the host machine's own OpenCode setup: it points
`XDG_CONFIG_HOME` at a throwaway temp directory for the run's subprocess
environment, so OMO Slim is enabled *only* by the temp workspace's own
`opencode.json` (`plugin: ["oh-my-opencode-slim@latest"]`) — never by
whatever global config the developer running the script happens to have.
This is what makes the result representative of "a project that opts into
OMO Slim", not "this particular developer's machine".

| Criterion (docs/tasks.md T0.2) | Result |
| --- | --- |
| Plugin loads under ACP (driven by `OpenCodeExecutor`, not TUI) | ✅ session creation logs `agent=orchestrator` (OMO Slim's default agent) instead of OpenCode's built-in `build`/`plan` agent, using only the project-local `opencode.json`, with `XDG_CONFIG_HOME` pointed at an empty directory |
| Orchestrator works as expected | ✅ orchestrator receives the prompt as `mode=primary`, plans the delegation, and reports back |
| designer / explorer / fixer delegation works | ✅ verified with `explorer`: orchestrator issues an ACP `tool_call` (`title=task`), a child session is created (`agent=explorer mode=subagent`, `parentID=<orchestrator session>`), executes, and reports results back — all visible as ordered `session/update` events on the *same* ACP stream, no side channel |
| No stdout pollution | ✅ structurally guaranteed (the executor never reads `child.stdout` directly, only the ACP ndjson stream — see `acp-client.ts`) and empirically confirmed: the ACP SDK's ndjson parser never failed across all scenarios, i.e. no non-JSON-RPC bytes reached stdout |
| Cancel works reliably | ✅ `cancel()` sends `session/cancel`; the run — including one with an in-flight delegated tool call — resolves as `cancelled` rather than hanging or running to completion |
| `cwd` always stays inside the worktree | ✅ the delegated `explorer` sub-session's `directory` is identical to the parent's `workspaceCwd` in every observed run; OMO Slim does not spawn sessions outside the configured workspace |

## Notes on `--pure` and terminology

`opencode acp --pure` disables all external plugins (confirmed empirically:
with `--pure`, session creation logs `agent=build`, OpenCode's built-in
default, instead of `agent=orchestrator`). Neither `launchAcpProcess` nor
`OpenCodeExecutor` currently pass `--pure`, so **the existing production
code path already allows OMO Slim (or any other configured plugin) to load
by default** — this spike validates exactly that default path, which is
also the one a real Runner uses today.

docs/requirements.md §7 phrases the check as "ACP pure mode 下
oh-my-opencode-slim 是否加载" ("whether OMO Slim loads under ACP pure
mode"), read here as "OpenCode driven purely through the ACP protocol
channel (no TUI stdout parsing)" — i.e. contrasting with a TUI-based
integration, not literally the `--pure` CLI flag (which by definition
disables the plugin under test). This spike validates the intended
scenario: OMO Slim through the ACP protocol channel.

## Known limitations to track (does not block MVP)

1. **No opt-out switch for the pure-ACP mode.** `OpenCodeExecutorOptions`
   has no way to force `opencode acp --pure`. If a bound project's OpenCode
   config enables a plugin that turns out to be ACP-incompatible, there is
   currently no per-run escape hatch — only removing the plugin from that
   project's `opencode.json`. Worth adding as a follow-up
   (`OpenCodeExecutorOptions.args` already supports passing extra flags
   like `--pure` manually, but there's no first-class config surface for
   it yet).
2. **Agent naming is plugin-specific and not guaranteed stable.** OMO
   Slim's real specialist agents are `explorer`, `oracle`, `council`,
   `librarian`, `designer`, `fixer` (plus `orchestrator`), which already
   matches the correction noted in `docs/architecture.md` §12 (the
   `designer / explorer / fixer` diagram was a simplification). Per
   architecture.md, the Control Server must keep treating these names as
   an internal OpenCode implementation detail and never depend on them —
   confirmed here to still hold: nothing in the ACP event stream requires
   the caller to know these names structurally (delegation surfaces as a
   generic `tool_call`/`tool_call_update` pair regardless of which
   sub-agent handled it).

## Incidental observation (not OMO Slim's fault)

An unrelated `Got response to unknown request null` line appeared on
stderr only when running against a developer's full personal global
OpenCode config (which also loads other plugins, e.g.
`@warp-dot-dev/opencode-warp`). It did not reproduce in the isolated
`XDG_CONFIG_HOME` setup used by this smoke test, so it is unrelated to OMO
Slim or the ACP integration — noted here only so it isn't mistaken for an
OMO Slim regression if seen elsewhere. It is a stderr diagnostic line only
(§7: stderr is never used for control flow), so it would not have affected
correctness either way.

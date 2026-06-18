# swarm-mcp

An [MCP](https://modelcontextprotocol.io) stdio server that exposes [Swarm](https://github.com/jcosta33/swarm)'s
read + reconcile facts to agent clients (Claude Desktop, Cursor) — so an agent mid-task can ask Swarm
*"what's my scope?"*, *"what evidence is missing?"*, *"what should the reviewer not miss?"* — **without
being allowed to declare itself done.**

## What it is — and what it is not

swarm-mcp is a **thin adapter over the `swarm` CLI's `--json` contract**. It spawns `swarm <cmd> --json`
with fixed arguments and reshapes the output into MCP tools, resources, and prompts. It does **not**
import swarm-cli's internals, run a model loop, write durable artifacts, or issue a verdict.

- **Reconcile-only.** Every *tool* result carries `noVerdictIssued: true`; resources serve the CLI's
  `--json` data verbatim (also no verdict, just unwrapped). swarm-mcp surfaces *facts* (coverage gaps,
  out-of-scope changes, empty-evidence Pass rows, self-report mismatches) and a *derived* human-attention
  list; a human or an independent reviewer owns the Pass / Fail / Unverified / Blocked result. An empty or
  weak Evidence cell reads Unverified regardless of a clean reconcile.
- **Root-confined.** It only reads inside a configured workspace root; every client-supplied input is
  validated before any subprocess runs. File paths are realpath-confined (no `..`, no absolute escapes, no
  symlink escapes); ids/stems must be a single safe segment; a git base must be a flag-free ref.
- **Many libraries, not a framework.** It couples to swarm-cli only through the public `--json`
  interface, so swarm-cli keeps its minimal footprint and each piece stays useful on its own.

## Run it

```jsonc
// Claude Desktop / Cursor MCP config
{
  "mcpServers": {
    "swarm": {
      "command": "swarm-mcp",
      "args": ["--workspace", "/path/to/your/swarm-workspace"]
    }
  }
}
```

Config: `--workspace <path>` / `SWARM_WORKSPACE` (the workspace root); `--swarm-bin <path>` / `SWARM_BIN`
(the `swarm` binary, default `swarm` on PATH). Requires the [`swarm` CLI](https://github.com/jcosta33/swarm-cli)
installed.

The `swarm-mcp` command above resolves to this package's bin. To install from source until a published
build is available:

```sh
git clone https://github.com/jcosta33/swarm-mcp && cd swarm-mcp
pnpm install && pnpm build && npm link   # exposes `swarm-mcp` on PATH (runs the built dist/)
```

Node: a published/built install needs Node ≥ 18.18; running from a source checkout (no `dist/`) needs
Node ≥ 22.6 (it strips types at runtime).

## v0 surface (read-only)

- **Tools (10).** Reconcile/check: `swarm_get_status`, `swarm_check_workspace`, `swarm_check_file`,
  `swarm_scan_task`, `swarm_reconcile_review`, `swarm_validate_review_packet`. Parsed-artifact loaders:
  `swarm_get_task`, `swarm_get_spec`, `swarm_get_review`, `swarm_get_checks`.
- **Resources (7).** Fixed: `swarm://workspace`, `swarm://status`, `swarm://checks`. Templated:
  `swarm://tasks/{id}`, `swarm://specs/{id}`, `swarm://reviews/{id}`, `swarm://findings/{id}`.
- **Prompts (5).** `swarm_task_briefing`, `swarm_before_done` (the implementer — *may not approve its own
  work*), `swarm_review_assistant` (an independent reviewer — *falsify, don't trust*), `swarm_evidence_rule`,
  `swarm_finding_candidate`. The before-done / review-assistant asymmetry is deliberate: no prompt grants
  verdict authority.

## Develop

```sh
pnpm install
pnpm gate   # typecheck + lint + coverage (thresholds enforced) + build
```

Status: **v0** — the full read + reconcile surface over the `swarm` CLI's `--json` contract. It couples to
swarm-cli only through that public contract (recorded in
[swarm ADR-0085](https://github.com/jcosta33/swarm/blob/main/docs/adrs/0085-swarm-mcp-adapts-the-json-contract.md)),
so swarm-cli keeps its minimal footprint and each piece stays useful on its own.

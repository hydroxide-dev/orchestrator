# AGENTS.md

## Project Shape
Hydroxide is a small multi-repo system. Treat these repositories as the current topology:

- `orchestrator` - the Hydroxide control plane and API
- `image` - curated image catalog and metadata
- `web` - separate web UI client
- `cli` - separate command-line client
- `.github` - shared GitHub configuration and repo hygiene

The `web` and `cli` repos should talk to Hydroxide through the orchestrator API. They should not depend on each other directly.

## Stack
- TypeScript only
- Bun for runtime, scripts, and package management
- SQLite for persistence in the orchestrator
- No raw JavaScript unless a tool or dependency forces it

## Working Rules
- Prefer small, explicit changes over broad refactors.
- Keep the orchestrator buildable and testable on its own.
- Favor simple data flow and clear contracts between repos.
- When adding code, assume Bun-first tooling and Bun-compatible libraries.
- Keep state and business logic in the orchestrator; keep UI and CLI thin.

## Orchestrator Guidance
- Use SQLite as the source of truth for local control-plane state.
- Model services, instances, nodes, operations, and status explicitly.
- Keep the API stable enough that `web` and `cli` can evolve separately.
- Avoid introducing extra infrastructure unless it is clearly needed.

## Repo Boundaries
- `image` owns image catalog metadata, not orchestration logic.
- `web` owns presentation and user interaction only.
- `cli` owns terminal UX and command ergonomics only.
- `.github` owns shared workflows and repo defaults only.

## Notes
- If a decision affects more than one repo, document the contract first.
- If a choice would make the system harder to reason about later, prefer the simpler option now.

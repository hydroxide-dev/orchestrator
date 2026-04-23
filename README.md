# orchestrator
The core of Hydroxide. Node-based.

## Quick Start

1. Copy `.env.example` to `.env` and fill in your Proxmox credentials.
2. Run `bun install`.
3. Run `bun run setup` and answer `Setup QuickShell?` if you want the container created.
4. Validate connectivity with `bun run doctor`.
5. Run a QuickShell command with:

```sh
bun run start -- quickshell -- 'whoami'
```

## What this slice does

- Authenticates to Proxmox VE with an API token.
- Connects to a PVE node over SSH.
- Uses the fixed QuickShell VMID `9999`.
- Creates the container only if it does not already exist.
- Starts the container if it is stopped.
- Runs a command inside the container with `pct exec`.
- Supports self-signed Proxmox TLS with `PVE_SKIP_TLS_VERIFY=true`.
- Or, better, set `PVE_CA_FILE` to the Proxmox root CA PEM.

## Scripts

- `bun run dev` - watch `index.ts`
- `bun run setup` - onboarding flow for QuickShell
- `bun run doctor` - verify auth and report QuickShell state
- `bun run start -- quickshell -- <command>` - create and run a QuickShell command
- `bun run test` - run tests
- `bun run typecheck` - run TypeScript type checking

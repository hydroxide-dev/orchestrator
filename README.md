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

## Current State

For now, this is a suuper basic implementation of QuickShell. Creates the CT (at VMID 9999) and lets you run commands on it. Still needs IAM and service creation.

## Scripts

- `bun run dev` - watch `index.ts`
- `bun run setup` - onboarding flow for QuickShell
- `bun run doctor` - verify auth and report QuickShell state
- `bun run start -- quickshell -- <command>` - create and run a QuickShell command
- `bun run test` - run tests
- `bun run typecheck` - run TypeScript type checking

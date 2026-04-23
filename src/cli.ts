import { loadConfig } from "./config";
import { formatSession, runQuickShell, setupQuickShell } from "./quickshell";
import { runRemoteCommand } from "./ssh";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

function usage(): string {
  return [
    "Hydroxide orchestrator",
    "",
    "Usage:",
    "  bun run index.ts [--verbose|-v] doctor",
    "  bun run index.ts [--verbose|-v] setup",
    "  bun run index.ts [--verbose|-v] quickshell -- <command>",
    "",
    "Examples:",
    "  bun run index.ts doctor",
    "  bun run index.ts setup",
    "  bun run index.ts quickshell -- 'whoami'",
    "  bun run index.ts quickshell -- 'uname -a'",
  ].join("\n");
}

async function doctor(verbose: boolean): Promise<void> {
  const config = loadConfig();
  const { PveApiClient, assertPveAuth } = await import("./pve");
  const client = new PveApiClient(
    config.pveUrl,
    config.pveTokenId,
    config.pveTokenSecret,
    config.pveSkipTlsVerify,
    config.pveCaFile,
  );
  const authLabel = await assertPveAuth(client);
  const sshResult = await runRemoteCommand(
    {
      host: config.sshHost,
      user: config.sshUser,
      port: config.sshPort,
      identityFile: config.sshIdentityFile,
      batchMode: config.sshBatchMode,
      strictHostKeyChecking: config.sshStrictHostKeyChecking,
    },
    `pct status ${config.quickshellVmid}`,
    { verbose, label: "doctor ssh" },
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        pve: authLabel,
        pveNode: config.pveNode,
        sshHost: config.sshHost,
        quickshell: {
          vmid: config.quickshellVmid,
          hostname: config.quickshellHostname,
          statusExitCode: sshResult.exitCode,
          statusOutput: sshResult.stdout.trim(),
        },
      },
      null,
      2,
    ),
  );
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

async function setup(argv: string[], verbose: boolean): Promise<void> {
  const config = loadConfig();
  const force = argv.includes("--yes") || argv.includes("-y");
  if (!force && !input.isTTY) {
    throw new Error("Setup requires an interactive terminal or --yes");
  }
  const shouldSetup = force ? true : await confirm("Setup QuickShell?");

  if (!shouldSetup) {
    console.log("Setup skipped.");
    return;
  }

  const result = await setupQuickShell(config, verbose);
  console.log(
    JSON.stringify(
      {
        ok: true,
        quickshell: result,
      },
      null,
      2,
    ),
  );
}

async function quickshell(argv: string[], verbose: boolean): Promise<void> {
  const command = argv.join(" ").trim();
  if (!command) {
    throw new Error("Missing QuickShell command");
  }

  const config = loadConfig();
  const session = await runQuickShell(config, command, verbose);
  console.log(formatSession(session));
  console.log("");
  console.log(JSON.stringify(session, null, 2));
}

export async function main(argv: string[]): Promise<void> {
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const filtered = argv.filter((arg) => arg !== "--verbose" && arg !== "-v");
  const [subcommand, ...rest] = filtered;

  try {
    if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
      console.log(usage());
      return;
    }

    if (subcommand === "doctor") {
      await doctor(verbose);
      return;
    }

    if (subcommand === "setup") {
      await setup(rest, verbose);
      return;
    }

    if (subcommand === "quickshell") {
      const commandArgs = rest[0] === "--" ? rest.slice(1) : rest;
      await quickshell(commandArgs, verbose);
      return;
    }

    throw new Error(`Unknown command: ${subcommand}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

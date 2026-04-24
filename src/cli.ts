import { loadConfig } from "./config";
import { readComputeFile } from "./compute";
import {
  importImagePlan,
  planImageImports,
  readImageStore,
  refreshImageStoreFromManifest,
  resolveImage,
} from "./images";
import type { ComputeCommandAction } from "./types";
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
    "  bun run index.ts [--verbose|-v] images import [--force] [all|<image-id> ...]",
    "  bun run index.ts [--verbose|-v] compute <add|update|delete> [file]",
    "",
    "Examples:",
    "  bun run index.ts doctor",
    "  bun run index.ts setup",
    "  bun run index.ts quickshell -- 'whoami'",
    "  bun run index.ts quickshell -- 'uname -a'",
    "  bun run index.ts images import all",
    "  bun run index.ts images import --force local/endeavouros",
    "  bun run index.ts compute add compute.yaml",
  ].join("\n");
}

async function doctor(verbose: boolean): Promise<void> {
  const config = await loadConfig();
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
  const config = await loadConfig();
  const force = argv.includes("--yes") || argv.includes("-y");
  if (!force && !input.isTTY) {
    throw new Error("Setup requires an interactive terminal or --yes");
  }
  const shouldSetup = force ? true : await confirm("Setup QuickShell?");

  if (!shouldSetup) {
    console.log("Setup skipped.");
    return;
  }

  await refreshImageStoreFromManifest();
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

  const config = await loadConfig();
  const session = await runQuickShell(config, command, verbose);
  console.log(formatSession(session));
  console.log("");
  console.log(JSON.stringify(session, null, 2));
}

async function compute(argv: string[], verbose: boolean): Promise<void> {
  const action = argv[0] as ComputeCommandAction | undefined;
  const file = argv[1] ?? "compute.yaml";

  if (!action || !["add", "update", "delete"].includes(action)) {
    throw new Error("Usage: compute <add|update|delete> [file]");
  }

  const instance = await readComputeFile(file);
  const imageStore = await readImageStore();
  const image = await resolveImage(instance.runtime.os, imageStore);

  console.log(
    JSON.stringify(
      {
        ok: true,
        verbose,
        compute: {
          action,
          file,
          instance,
          image,
        },
      },
      null,
      2,
    ),
  );
}

async function images(argv: string[], verbose: boolean): Promise<void> {
  const subcommand = argv[0];
  if (subcommand === "sync") {
    const store = await refreshImageStoreFromManifest();
    console.log(JSON.stringify({ ok: true, images: store.images.length }, null, 2));
    return;
  }

  if (subcommand !== "import") {
    throw new Error("Usage: images sync | images import [--force] [all|<image-id> ...]");
  }

  const force = argv.includes("--force") || argv.includes("-f");
  const targets = argv.filter((arg) => arg !== "import" && arg !== "--force" && arg !== "-f");
  const imageStore = await readImageStore();
  const requestedIds = targets.length === 0 || targets[0] === "all" ? imageStore.images.map((entry) => entry.id) : targets;
  const plans = planImageImports(
    await Promise.all(requestedIds.map(async (id) => resolveImage(id, imageStore))),
    force,
  );

  const config = await loadConfig();
  const { runRemoteCommand } = await import("./ssh");
  const sshTarget = {
    host: config.sshHost,
    user: config.sshUser,
    port: config.sshPort,
    identityFile: config.sshIdentityFile,
    batchMode: config.sshBatchMode,
    strictHostKeyChecking: config.sshStrictHostKeyChecking,
  };

  const results = [];
  for (const plan of plans) {
    const exists = await runRemoteCommand(
      sshTarget,
      `test -f ${JSON.stringify(plan.localPath)}`,
      { verbose, label: `image exists ${plan.id}` },
    );

    const result = await importImagePlan(
      plan,
      async (command) => {
        const response = await runRemoteCommand(sshTarget, command, { verbose, label: `image import ${plan.id}` });
        return response;
      },
      async () => exists.exitCode === 0,
    );

    results.push(result);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        force,
        imported: results.filter((item) => item.imported).length,
        skipped: results.filter((item) => item.skipped).length,
        results,
      },
      null,
      2,
    ),
  );
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

    if (subcommand === "compute") {
      await compute(rest, verbose);
      return;
    }

    if (subcommand === "images") {
      await images(rest, verbose);
      return;
    }

    throw new Error(`Unknown command: ${subcommand}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

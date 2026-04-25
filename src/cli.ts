import { loadConfig, loadStateConfig } from "./config";
import { archiveComputeSource, buildInstanceRecord, markInstanceDeleteRequested } from "./compute-store";
import { readComputeFile } from "./compute";
import { openSqlite } from "./db";
import { createOperation, finishOperation, initEventsDb, nowIso, startOperation } from "./events";
import {
  importImagePlan,
  planImageImports,
  readImageStore,
  refreshImageStoreFromManifest,
  resolveImage,
} from "./images";
import { initInstancesDb, insertInstance, readInstance, updateInstance } from "./instances";
import type { ComputeCommandAction, OperationEventName } from "./types";
import { formatSession, runQuickShell, setupQuickShell } from "./quickshell";
import { runRemoteCommand } from "./ssh";
import { randomUUID } from "node:crypto";
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
    "  bun run index.ts [--verbose|-v] compute create [file]",
    "  bun run index.ts [--verbose|-v] compute update --uuid <instance-uuid> [file]",
    "  bun run index.ts [--verbose|-v] compute delete --uuid <instance-uuid>",
    "",
    "Examples:",
    "  bun run index.ts doctor",
    "  bun run index.ts setup",
    "  bun run index.ts quickshell -- 'whoami'",
    "  bun run index.ts quickshell -- 'uname -a'",
    "  bun run index.ts images import all",
    "  bun run index.ts images import --force local/endeavouros",
    "  bun run index.ts compute create compute.yaml",
  ].join("\n");
}

function actorName(): string {
  return Bun.env.HYDROXIDE_ACTOR?.trim() || Bun.env.USER?.trim() || "local";
}

function parseUuidArg(args: string[]): { uuid: string; rest: string[] } {
  const index = args.indexOf("--uuid");
  if (index === -1 || !args[index + 1]) {
    throw new Error("Missing required --uuid <instance-uuid>");
  }

  return {
    uuid: args[index + 1] as string,
    rest: args.filter((_, itemIndex) => itemIndex !== index && itemIndex !== index + 1),
  };
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

  const eventsDb = await openSqlite(config.stateEventsDb);
  initEventsDb(eventsDb);
  const event = createOperation(eventsDb, {
    eventName: "images.sync",
    humanName: "Images sync",
    actor: actorName(),
    targetNode: config.pveNode,
    payload: { action: "setup" },
  });
  try {
    startOperation(eventsDb, event.id);
    await refreshImageStoreFromManifest();
    finishOperation(eventsDb, event.id, "succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishOperation(eventsDb, event.id, "failed", message);
    throw error;
  } finally {
    eventsDb.close();
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

  const config = await loadConfig();
  const session = await runQuickShell(config, command, verbose);
  console.log(formatSession(session));
  console.log("");
  console.log(JSON.stringify(session, null, 2));
}

async function compute(argv: string[], verbose: boolean): Promise<void> {
  const action = argv[0] as ComputeCommandAction | undefined;

  if (!action || !["create", "update", "delete"].includes(action)) {
    throw new Error("Usage: compute create [file] | compute update --uuid <id> [file] | compute delete --uuid <id>");
  }

  const config = await loadConfig();
  const eventsDb = await openSqlite(config.stateEventsDb);
  const instancesDb = await openSqlite(config.stateInstancesDb);
  initEventsDb(eventsDb);
  initInstancesDb(instancesDb);

  const actionArgs = argv.slice(1);
  const parsed = action === "create" ? { uuid: randomUUID(), rest: actionArgs } : parseUuidArg(actionArgs);
  const file = action === "delete" ? undefined : parsed.rest[0] ?? "compute.yaml";
  const eventName: OperationEventName = `compute.${action}`;
  const event = createOperation(eventsDb, {
    eventName,
    humanName: `Compute ${action}`,
    actor: actorName(),
    targetInstance: parsed.uuid,
    targetNode: config.pveNode,
    payload: {
      action,
      file,
      uuid: parsed.uuid,
    },
  });

  try {
    startOperation(eventsDb, event.id);

    if (action === "delete") {
      const existing = readInstance(instancesDb, parsed.uuid);
      if (!existing) {
        throw new Error(`Unknown instance UUID: ${parsed.uuid}`);
      }

      const record = markInstanceDeleteRequested(existing, nowIso());
      updateInstance(instancesDb, record);
      finishOperation(eventsDb, event.id, "succeeded");
      console.log(
        JSON.stringify(
          {
            ok: true,
            verbose,
            compute: {
              action,
              instanceUuid: parsed.uuid,
              instanceStatus: record.status,
              instancesDb: config.stateInstancesDb,
              eventsDb: config.stateEventsDb,
              eventsWritten: [event.id],
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    if (!file) {
      throw new Error(`Missing compute file for ${action}`);
    }

    const instance = await readComputeFile(file);
    const prior = action === "update" ? readInstance(instancesDb, parsed.uuid) : undefined;
    if (action === "update" && !prior) {
      throw new Error(`Unknown instance UUID: ${parsed.uuid}`);
    }

    const imageStore = await readImageStore();
    const image = await resolveImage(instance.runtime.os, imageStore);
    const archive = await archiveComputeSource(file, config.stateInstanceConfigDir, parsed.uuid);

    const record = buildInstanceRecord({
      uuid: parsed.uuid,
      status: action === "create" ? "desired" : "updated",
      compute: instance,
      image,
      archive,
      now: nowIso(),
      prior,
    });

    if (action === "create") {
      insertInstance(instancesDb, record);
    } else {
      updateInstance(instancesDb, record);
    }

    finishOperation(eventsDb, event.id, "succeeded");
    console.log(
      JSON.stringify(
        {
          ok: true,
          verbose,
          compute: {
            action,
            file,
            instanceUuid: parsed.uuid,
            instanceStatus: record.status,
            computePath: record.computePath,
            instancesDb: config.stateInstancesDb,
            eventsDb: config.stateEventsDb,
            eventsWritten: [event.id],
            instance,
            image,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishOperation(eventsDb, event.id, "failed", message);
    throw error;
  } finally {
    instancesDb.close();
    eventsDb.close();
  }
}

async function images(argv: string[], verbose: boolean): Promise<void> {
  const subcommand = argv[0];

  if (subcommand === "sync") {
    const config = await loadStateConfig();
    const eventsDb = await openSqlite(config.stateEventsDb);
    initEventsDb(eventsDb);
    const event = createOperation(eventsDb, {
      eventName: "images.sync",
      humanName: "Images sync",
      actor: actorName(),
      targetNode: config.pveNode,
      payload: { action: "sync" },
    });
    try {
      startOperation(eventsDb, event.id);
      const store = await refreshImageStoreFromManifest();
      finishOperation(eventsDb, event.id, "succeeded");
      console.log(JSON.stringify({ ok: true, images: store.images.length, eventsWritten: [event.id] }, null, 2));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishOperation(eventsDb, event.id, "failed", message);
      throw error;
    } finally {
      eventsDb.close();
    }
  }

  if (subcommand !== "import") {
    throw new Error("Usage: images sync | images import [--force] [all|<image-id> ...]");
  }

  const config = await loadConfig();
  const eventsDb = await openSqlite(config.stateEventsDb);
  initEventsDb(eventsDb);

  try {
    const force = argv.includes("--force") || argv.includes("-f");
    const targets = argv.filter((arg) => arg !== "import" && arg !== "--force" && arg !== "-f");
    const imageStore = await readImageStore();
    const requestedIds = targets.length === 0 || targets[0] === "all" ? imageStore.images.map((entry) => entry.id) : targets;
    const plans = planImageImports(
      await Promise.all(requestedIds.map(async (id) => resolveImage(id, imageStore))),
      force,
    );

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
    const eventsWritten = [];
    for (const plan of plans) {
      const event = createOperation(eventsDb, {
        eventName: "images.pull",
        humanName: "Images pull",
        actor: actorName(),
        targetNode: config.pveNode,
        payload: {
          imageId: plan.id,
          localPath: plan.localPath,
          downloadUrl: plan.downloadUrl,
          force: plan.force,
        },
      });
      eventsWritten.push(event.id);

      try {
        startOperation(eventsDb, event.id);
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

        finishOperation(eventsDb, event.id, "succeeded");
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finishOperation(eventsDb, event.id, "failed", message);
        throw error;
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          force,
          imported: results.filter((item) => item.imported).length,
          skipped: results.filter((item) => item.skipped).length,
          eventsWritten,
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    eventsDb.close();
  }
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

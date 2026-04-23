import { assertPveAuth, PveApiClient, summarizeRunResult } from "./pve";
import { quoteShell, runRemoteCommand, type SshTarget } from "./ssh";
import type { AppConfig, QuickShellSession, RunResult } from "./types";

type ContainerState = "missing" | "running" | "stopped";

type VerboseLogger = {
  verbose: boolean;
  log: (message: string) => void;
};

function createLogger(verbose: boolean): VerboseLogger {
  return {
    verbose,
    log: (message: string) => {
      if (verbose) {
        console.error(message);
      }
    },
  };
}

function buildPctCreateCommand(config: AppConfig): string {
  return [
    "pct",
    "create",
    String(config.quickshellVmid),
    quoteShell(config.quickshellTemplate),
    "--hostname",
    quoteShell(config.quickshellHostname),
    "--storage",
    quoteShell(config.quickshellStorage),
    "--password",
    quoteShell(config.quickshellPassword),
    "--cores",
    String(config.quickshellCores),
    "--memory",
    String(config.quickshellMemory),
    "--swap",
    String(config.quickshellSwap),
    "--unprivileged",
    config.quickshellUnprivileged ? "1" : "0",
    "--net0",
    quoteShell(`name=eth0,bridge=${config.quickshellBridge}`),
  ].join(" ");
}

function buildPctStartCommand(vmid: number): string {
  return ["pct", "start", String(vmid)].join(" ");
}

function buildPctStatusCommand(vmid: number): string {
  return ["pct", "status", String(vmid)].join(" ");
}

function parseContainerState(result: RunResult): ContainerState {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (result.exitCode !== 0 && /does not exist|not found|no such/i.test(output)) {
    return "missing";
  }

  if (/status:\s+running/i.test(output)) {
    return "running";
  }

  if (/status:\s+stopped/i.test(output)) {
    return "stopped";
  }

  if (result.exitCode !== 0) {
    return "missing";
  }

  return "stopped";
}

async function ensureQuickShell(
  target: SshTarget,
  config: AppConfig,
  verbose = false,
): Promise<{ create?: RunResult; start: RunResult; state: ContainerState; started: boolean; lastState?: RunResult }> {
  const logger = createLogger(verbose);
  logger.log(`[quickshell] checking VMID ${config.quickshellVmid}`);
  const status = await runRemoteCommand(target, buildPctStatusCommand(config.quickshellVmid), {
    verbose,
    label: "pct status",
  });
  const state = parseContainerState(status);
  logger.log(`[quickshell] initial state for ${config.quickshellVmid}: ${state}`);

  if (state === "missing") {
    logger.log(`[quickshell] creating VMID ${config.quickshellVmid} as ${config.quickshellHostname}`);
    const create = await runRemoteCommand(target, buildPctCreateCommand(config), {
      verbose,
      label: "pct create",
    });
    if (create.exitCode !== 0) {
      throw new Error(`QuickShell create failed:\n${create.stderr || create.stdout}`);
    }

    logger.log(`[quickshell] starting VMID ${config.quickshellVmid} after create`);
    const start = await runRemoteCommand(target, buildPctStartCommand(config.quickshellVmid), {
      verbose,
      label: "pct start",
    });
    if (start.exitCode !== 0) {
      throw new Error(`QuickShell start failed after create:\n${start.stderr || start.stdout}`);
    }

    return { create, start, state: "running", started: true };
  }

  if (state === "stopped") {
    logger.log(`[quickshell] starting stopped VMID ${config.quickshellVmid}`);
    const start = await runRemoteCommand(target, buildPctStartCommand(config.quickshellVmid), {
      verbose,
      label: "pct start",
    });
    if (start.exitCode !== 0) {
      throw new Error(`QuickShell start failed:\n${start.stderr || start.stdout}`);
    }

    return { start, state: "running", started: true };
  }

  logger.log(`[quickshell] VMID ${config.quickshellVmid} already running`);
  return { start: status, state: "running", started: false };
}

function buildPctExecCommand(vmid: number, command: string): string {
  const encoded = Buffer.from(command, "utf8").toString("base64");
  const script = `printf %s ${quoteShell(encoded)} | base64 -d | /bin/sh`;
  return ["pct", "exec", String(vmid), "--", "/bin/sh", "-lc", quoteShell(script)].join(" ");
}

async function waitForRunning(target: SshTarget, vmid: number, verbose = false, timeoutMs = 120_000): Promise<void> {
  const startedAt = Date.now();
  const log = verbose ? (message: string) => console.error(message) : undefined;
  let lastStatus: RunResult | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await runRemoteCommand(target, buildPctStatusCommand(vmid), {
      verbose,
      label: "pct status poll",
    });
    lastStatus = result;
    log?.(`[quickshell] poll VMID ${vmid}: ${result.stdout.trim() || result.stderr.trim() || "(empty)"}`);
    if (result.exitCode === 0 && /status:\s+running/i.test(result.stdout)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(
    [
      `Container ${vmid} did not reach running state within ${timeoutMs}ms`,
      lastStatus ? `last stdout: ${lastStatus.stdout.trimEnd() || "(empty)"}` : "last stdout: (no status check completed)",
      lastStatus ? `last stderr: ${lastStatus.stderr.trimEnd() || "(empty)"}` : "last stderr: (no status check completed)",
    ].join("\n"),
  );
}

export async function runQuickShell(config: AppConfig, command: string, verbose = false): Promise<QuickShellSession> {
  const pve = new PveApiClient(
    config.pveUrl,
    config.pveTokenId,
    config.pveTokenSecret,
    config.pveSkipTlsVerify,
    config.pveCaFile,
  );
  const authLabel = await assertPveAuth(pve);
  const sshTarget: SshTarget = {
    host: config.sshHost,
    user: config.sshUser,
    port: config.sshPort,
    identityFile: config.sshIdentityFile,
    batchMode: config.sshBatchMode,
    strictHostKeyChecking: config.sshStrictHostKeyChecking,
  };

  const logger = createLogger(verbose);
  logger.log(`[quickshell] authenticating to PVE ${config.pveUrl}`);
  const ensure = await ensureQuickShell(sshTarget, config, verbose);
  await waitForRunning(sshTarget, config.quickshellVmid, verbose);

  logger.log(`[quickshell] exec in VMID ${config.quickshellVmid}: ${command}`);
  const commandResult = await runRemoteCommand(sshTarget, buildPctExecCommand(config.quickshellVmid, command), {
    verbose,
    label: "pct exec",
  });
  if (commandResult.exitCode !== 0) {
    throw new Error(`QuickShell command failed on ${authLabel}:\n${commandResult.stderr || commandResult.stdout}`);
  }

  return {
    vmid: config.quickshellVmid,
    hostname: config.quickshellHostname,
    node: config.pveNode,
    create: ensure.create
      ? summarizeRunResult(ensure.create.command, ensure.create.exitCode, ensure.create.stdout, ensure.create.stderr)
      : summarizeRunResult("pct create (skipped)", 0, "", ""),
    start: summarizeRunResult(ensure.start.command, ensure.start.exitCode, ensure.start.stdout, ensure.start.stderr),
    command: summarizeRunResult(commandResult.command, commandResult.exitCode, commandResult.stdout, commandResult.stderr),
  };
}

export async function setupQuickShell(
  config: AppConfig,
  verbose = false,
): Promise<{ vmid: number; hostname: string; created: boolean; started: boolean }> {
  const pve = new PveApiClient(
    config.pveUrl,
    config.pveTokenId,
    config.pveTokenSecret,
    config.pveSkipTlsVerify,
    config.pveCaFile,
  );
  const logger = createLogger(verbose);
  logger.log(`[setup] authenticating to PVE ${config.pveUrl}`);
  await assertPveAuth(pve);
  const sshTarget: SshTarget = {
    host: config.sshHost,
    user: config.sshUser,
    port: config.sshPort,
    identityFile: config.sshIdentityFile,
    batchMode: config.sshBatchMode,
    strictHostKeyChecking: config.sshStrictHostKeyChecking,
  };

  const ensure = await ensureQuickShell(sshTarget, config, verbose);

  return {
    vmid: config.quickshellVmid,
    hostname: config.quickshellHostname,
    created: Boolean(ensure.create),
    started: ensure.started,
  };
}

export function formatSession(session: QuickShellSession): string {
  return [
    `QuickShell VMID: ${session.vmid}`,
    `Hostname: ${session.hostname}`,
    `Node: ${session.node}`,
    `Create exit: ${session.create.exitCode}`,
    `Start exit: ${session.start.exitCode}`,
    `Command exit: ${session.command.exitCode}`,
    "",
    "stdout:",
    session.command.stdout.trimEnd() || "(empty)",
    "",
    "stderr:",
    session.command.stderr.trimEnd() || "(empty)",
  ].join("\n");
}

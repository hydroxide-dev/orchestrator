import type { RunResult } from "./types";

export type SshTarget = {
  host: string;
  user: string;
  port: number;
  identityFile?: string;
  batchMode: boolean;
  strictHostKeyChecking: boolean;
};

export type SpawnOptions = {
  cwd?: string;
  verbose?: boolean;
  label?: string;
  timeoutMs?: number;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function buildSshArgs(target: SshTarget, remoteCommand: string): string[] {
  const args = [
    "-n",
    "-T",
    "-p",
    String(target.port),
    "-o",
    `BatchMode=${target.batchMode ? "yes" : "no"}`,
    "-o",
    `StrictHostKeyChecking=${target.strictHostKeyChecking ? "yes" : "no"}`,
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ServerAliveInterval=10",
    "-o",
    "ServerAliveCountMax=1",
  ];

  if (target.identityFile) {
    args.push("-i", target.identityFile);
  }

  args.push(`${target.user}@${target.host}`);
  args.push(remoteCommand);
  return args;
}

export async function runRemoteCommand(
  target: SshTarget,
  remoteCommand: string,
  options: SpawnOptions = {},
): Promise<RunResult> {
  const startedAt = Date.now();
  const log = options.verbose ? (message: string) => console.error(message) : undefined;
  const label = options.label ?? "ssh";
  const timeoutMs = options.timeoutMs ?? 60_000;
  log?.(`[${label}] ${target.user}@${target.host}: ${remoteCommand}`);

  const ssh = Bun.spawn({
    cmd: ["ssh", ...buildSshArgs(target, remoteCommand)],
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<number>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      try {
        ssh.kill();
      } catch {
        // Best effort; we'll still surface the timeout below.
      }
      reject(new Error(`SSH command timed out after ${timeoutMs}ms: ${remoteCommand}`));
    }, timeoutMs);
  });

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(ssh.stdout).text(),
      new Response(ssh.stderr).text(),
      Promise.race([ssh.exited, timeoutPromise]),
    ]);

    log?.(
      `[${label}] exit=${exitCode} elapsed=${Date.now() - startedAt}ms stdout=${stdout.trimEnd() || "(empty)"} stderr=${stderr.trimEnd() || "(empty)"}`,
    );

    return {
      command: `ssh ${target.user}@${target.host} ${remoteCommand}`,
      exitCode,
      stdout,
      stderr,
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function quoteShell(value: string): string {
  return shellQuote(value);
}

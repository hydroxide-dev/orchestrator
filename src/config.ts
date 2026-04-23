import type { AppConfig } from "./types";

function required(name: string, fallback?: string): string {
  const value = Bun.env[name] ?? fallback;
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const value = Bun.env[name];
  if (value == null || value.trim() === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function optionalNumber(name: string, fallback: number): number {
  const value = Bun.env[name];
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return parsed;
}

export function loadConfig(): AppConfig {
  const pveUrl = required("PVE_URL");
  const pveTokenId = required("PVE_TOKEN_ID");
  const pveTokenSecret = required("PVE_TOKEN_SECRET");
  const pveNode = required("PVE_NODE");
  const sshHost = required("PVE_SSH_HOST", pveNode);
  const sshUser = required("PVE_SSH_USER", "root");
  const quickshellTemplate = required("QUICKSHELL_OSTEMPLATE");
  const quickshellStorage = required("QUICKSHELL_STORAGE");
  const quickshellBridge = required("QUICKSHELL_BRIDGE", "vmbr0");
  const quickshellPassword = required("QUICKSHELL_PASSWORD");
  const quickshellVmid = optionalNumber("QUICKSHELL_VMID", 9999);
  const quickshellHostname = required("QUICKSHELL_HOSTNAME", "quickshell");

  return {
    pveUrl: pveUrl.replace(/\/+$/, ""),
    pveTokenId,
    pveTokenSecret,
    pveNode,
    pveSkipTlsVerify: optionalBoolean("PVE_SKIP_TLS_VERIFY", false),
    pveCaFile: Bun.env.PVE_CA_FILE?.trim() || undefined,
    sshHost,
    sshUser,
    sshPort: optionalNumber("PVE_SSH_PORT", 22),
    sshIdentityFile: Bun.env.PVE_SSH_IDENTITY_FILE?.trim() || undefined,
    sshBatchMode: optionalBoolean("PVE_SSH_BATCH_MODE", true),
    sshStrictHostKeyChecking: optionalBoolean("PVE_SSH_STRICT_HOST_KEY_CHECKING", false),
    quickshellTemplate,
    quickshellStorage,
    quickshellBridge,
    quickshellPassword,
    quickshellVmid,
    quickshellHostname,
    quickshellMemory: optionalNumber("QUICKSHELL_MEMORY", 256),
    quickshellCores: optionalNumber("QUICKSHELL_CORES", 1),
    quickshellSwap: optionalNumber("QUICKSHELL_SWAP", 256),
    quickshellUnprivileged: optionalBoolean("QUICKSHELL_UNPRIVILEGED", true),
  };
}

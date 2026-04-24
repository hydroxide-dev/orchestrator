import type { AppConfig } from "./types";

type ConfigScalar = string | number | boolean | null;

type EnvReference = {
  $env: string;
  default?: ConfigScalar;
  defaultFrom?: string;
};

type ConfigValue = ConfigScalar | EnvReference;

type ConfigFile = {
  pve: {
    url: ConfigValue;
    tokenId: ConfigValue;
    tokenSecret: ConfigValue;
    node: ConfigValue;
    skipTlsVerify: ConfigValue;
    caFile?: ConfigValue;
  };
  ssh: {
    host: ConfigValue;
    user: ConfigValue;
    port: ConfigValue;
    identityFile?: ConfigValue;
    batchMode: ConfigValue;
    strictHostKeyChecking: ConfigValue;
  };
  quickshell: {
    template: ConfigValue;
    storage: ConfigValue;
    bridge: ConfigValue;
    password: ConfigValue;
    vmid: ConfigValue;
    hostname: ConfigValue;
    memory: ConfigValue;
    cores: ConfigValue;
    swap: ConfigValue;
    unprivileged: ConfigValue;
  };
};

const CONFIG_PATH = "./config/config.json";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnvReference(value: ConfigValue): value is EnvReference {
  return isObject(value) && typeof value.$env === "string";
}

function parseBoolean(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Configuration value ${name} must be a boolean`);
}

function parseNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Configuration value ${name} must be a number`);
  }
  return parsed;
}

function getPathValue(source: unknown, path: string): ConfigScalar | undefined {
  const parts = path.split(".");
  let current: unknown = source;

  for (const part of parts) {
    if (!isObject(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  if (current == null || typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
    return current;
  }

  return undefined;
}

function coerceResolvedValue(
  value: ConfigScalar | undefined,
  name: string,
  kind: "string" | "number" | "boolean",
  required = true,
): string | number | boolean | undefined {
  if (value == null) {
    if (required) {
      throw new Error(`Missing required configuration value: ${name}`);
    }
    return undefined;
  }

  if (kind === "string") {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        if (required) {
          throw new Error(`Missing required configuration value: ${name}`);
        }
        return undefined;
      }
      return trimmed;
    }
    return String(value);
  }

  if (kind === "number") {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error(`Configuration value ${name} must be a number`);
      }
      return value;
    }
    if (typeof value === "string") {
      return parseNumber(value.trim(), name);
    }
    throw new Error(`Configuration value ${name} must be a number`);
  }

  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return parseBoolean(value, name);
  }
  throw new Error(`Configuration value ${name} must be a boolean`);
}

function resolveValue(raw: ConfigValue | undefined, root: ConfigFile, name: string): ConfigScalar | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!isEnvReference(raw)) {
    return raw;
  }

  const envValue = Bun.env[raw.$env];
  if (envValue != null && envValue.trim() !== "") {
    return envValue.trim();
  }

  if (raw.defaultFrom) {
    const fallback = getPathValue(root, raw.defaultFrom);
    const resolvedFallback = resolveValue(fallback as ConfigValue | undefined, root, `${name} -> ${raw.defaultFrom}`);
    if (resolvedFallback !== undefined) {
      return resolvedFallback;
    }
  }

  return raw.default;
}

async function readConfigFile(): Promise<ConfigFile> {
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) {
    throw new Error(`Missing config file: ${CONFIG_PATH}`);
  }

  return (await file.json()) as ConfigFile;
}

export async function loadConfig(): Promise<AppConfig> {
  const root = await readConfigFile();

  return {
    pveUrl: String(coerceResolvedValue(resolveValue(root.pve.url, root, "pve.url"), "pve.url", "string")).replace(/\/+$/, ""),
    pveTokenId: String(coerceResolvedValue(resolveValue(root.pve.tokenId, root, "pve.tokenId"), "pve.tokenId", "string")),
    pveTokenSecret: String(
      coerceResolvedValue(resolveValue(root.pve.tokenSecret, root, "pve.tokenSecret"), "pve.tokenSecret", "string"),
    ),
    pveNode: String(coerceResolvedValue(resolveValue(root.pve.node, root, "pve.node"), "pve.node", "string")),
    pveSkipTlsVerify: Boolean(
      coerceResolvedValue(resolveValue(root.pve.skipTlsVerify, root, "pve.skipTlsVerify"), "pve.skipTlsVerify", "boolean"),
    ),
    pveCaFile: coerceResolvedValue(resolveValue(root.pve.caFile, root, "pve.caFile"), "pve.caFile", "string", false) as
      | string
      | undefined,
    sshHost: String(coerceResolvedValue(resolveValue(root.ssh.host, root, "ssh.host"), "ssh.host", "string")),
    sshUser: String(coerceResolvedValue(resolveValue(root.ssh.user, root, "ssh.user"), "ssh.user", "string")),
    sshPort: Number(coerceResolvedValue(resolveValue(root.ssh.port, root, "ssh.port"), "ssh.port", "number")),
    sshIdentityFile: coerceResolvedValue(
      resolveValue(root.ssh.identityFile, root, "ssh.identityFile"),
      "ssh.identityFile",
      "string",
      false,
    ) as string | undefined,
    sshBatchMode: Boolean(
      coerceResolvedValue(resolveValue(root.ssh.batchMode, root, "ssh.batchMode"), "ssh.batchMode", "boolean"),
    ),
    sshStrictHostKeyChecking: Boolean(
      coerceResolvedValue(
        resolveValue(root.ssh.strictHostKeyChecking, root, "ssh.strictHostKeyChecking"),
        "ssh.strictHostKeyChecking",
        "boolean",
      ),
    ),
    quickshellTemplate: String(
      coerceResolvedValue(resolveValue(root.quickshell.template, root, "quickshell.template"), "quickshell.template", "string"),
    ),
    quickshellStorage: String(
      coerceResolvedValue(resolveValue(root.quickshell.storage, root, "quickshell.storage"), "quickshell.storage", "string"),
    ),
    quickshellBridge: String(
      coerceResolvedValue(resolveValue(root.quickshell.bridge, root, "quickshell.bridge"), "quickshell.bridge", "string"),
    ),
    quickshellPassword: String(
      coerceResolvedValue(resolveValue(root.quickshell.password, root, "quickshell.password"), "quickshell.password", "string"),
    ),
    quickshellVmid: Number(
      coerceResolvedValue(resolveValue(root.quickshell.vmid, root, "quickshell.vmid"), "quickshell.vmid", "number"),
    ),
    quickshellHostname: String(
      coerceResolvedValue(resolveValue(root.quickshell.hostname, root, "quickshell.hostname"), "quickshell.hostname", "string"),
    ),
    quickshellMemory: Number(
      coerceResolvedValue(resolveValue(root.quickshell.memory, root, "quickshell.memory"), "quickshell.memory", "number"),
    ),
    quickshellCores: Number(
      coerceResolvedValue(resolveValue(root.quickshell.cores, root, "quickshell.cores"), "quickshell.cores", "number"),
    ),
    quickshellSwap: Number(
      coerceResolvedValue(resolveValue(root.quickshell.swap, root, "quickshell.swap"), "quickshell.swap", "number"),
    ),
    quickshellUnprivileged: Boolean(
      coerceResolvedValue(
        resolveValue(root.quickshell.unprivileged, root, "quickshell.unprivileged"),
        "quickshell.unprivileged",
        "boolean",
      ),
    ),
  };
}

export type RunResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type AppConfig = {
  pveUrl: string;
  pveTokenId: string;
  pveTokenSecret: string;
  pveNode: string;
  pveSkipTlsVerify: boolean;
  pveCaFile?: string;
  sshHost: string;
  sshUser: string;
  sshPort: number;
  sshIdentityFile?: string;
  sshBatchMode: boolean;
  sshStrictHostKeyChecking: boolean;
  quickshellTemplate: string;
  quickshellStorage: string;
  quickshellBridge: string;
  quickshellPassword: string;
  quickshellVmid: number;
  quickshellHostname: string;
  quickshellMemory: number;
  quickshellCores: number;
  quickshellSwap: number;
  quickshellUnprivileged: boolean;
};

export type QuickShellSession = {
  vmid: number;
  hostname: string;
  node: string;
  create: RunResult;
  start: RunResult;
  command: RunResult;
};

export type ImageStoreVersion = 1;

export type ImageStoreEntry = {
  id: string;
  pvePath: string;
  downloadUrl?: string;
  manifestUrl?: string;
  manifestId?: string;
};

export type ImageStore = {
  version: ImageStoreVersion;
  images: ImageStoreEntry[];
};

export type ImageReferenceKind = "local" | "github";

export type ImageReference = {
  kind: ImageReferenceKind;
  id: string;
  repository?: string;
  imageId: string;
};

export type ResolvedImageSource = {
  kind: ImageReferenceKind;
  url?: string;
  repository?: string;
  manifestUrl?: string;
  manifestId?: string;
};

export type ResolvedImage = {
  id: string;
  pvePath: string;
  downloadUrl: string;
  source: ResolvedImageSource;
};

export type ComputeVersion = 1;

export type ComputeInstanceDisk = {
  id: string;
  type: string;
  size: number;
};

export type ComputeInstanceBridge = {
  name: string;
  ipv4?: string;
  ipv6?: string;
};

export type ComputeInstance = {
  version: ComputeVersion;
  resources: {
    cpu: {
      cores: number;
    };
    ram: {
      amount: number;
    };
    disk: ComputeInstanceDisk[];
    network: {
      ports: string[];
      bridges: ComputeInstanceBridge[];
    };
  };
  runtime: {
    os: string;
  };
};

export type ComputeCommandAction = "add" | "update" | "delete";

export type ComputeCommandResult = {
  action: ComputeCommandAction;
  file: string;
  instance: ComputeInstance;
  image: ResolvedImage;
};

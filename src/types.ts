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
  stateInstanceConfigDir: string;
  stateInstancesDb: string;
  stateEventsDb: string;
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
  localPath: string;
  downloadUrl?: string;
  manifestUrl?: string;
  manifestId?: string;
  sourceKind?: "local" | "github";
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
  localPath: string;
  downloadUrl: string;
  source: ResolvedImageSource;
};

export type ImageImportPlan = {
  id: string;
  localPath: string;
  downloadUrl: string;
  source: ResolvedImageSource;
  force: boolean;
};

export type ImageImportResult = {
  id: string;
  localPath: string;
  downloadUrl: string;
  imported: boolean;
  skipped: boolean;
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
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

export type ComputeCommandAction = "create" | "update" | "delete";

export type ComputeCommandResult = {
  action: ComputeCommandAction;
  file: string;
  instance: ComputeInstance;
  image: ResolvedImage;
};

export type InstanceStatus = "desired" | "updated" | "delete_requested";

export type InstanceRecord = {
  uuid: string;
  name?: string;
  vmid?: number;
  node?: string;
  status: InstanceStatus;
  computePath: string;
  computeSha256: string;
  imageId: string;
  imageLocalPath: string;
  cpuCores: number;
  ramMb: number;
  desiredJson: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type OperationEventName =
  | "compute.create"
  | "compute.update"
  | "compute.delete"
  | "images.sync"
  | "images.pull";

export type OperationStatus = "pending" | "running" | "succeeded" | "failed";

export type OperationSource = "user" | "reconciler";

export type OperationEventRecord = {
  id: string;
  eventName: OperationEventName;
  humanName: string;
  actor: string;
  targetService?: string;
  targetInstance?: string;
  targetNode?: string;
  status: OperationStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  retryAt?: string;
  retryCount: number;
  failureReason?: string;
  payloadJson: string;
  source: OperationSource;
};

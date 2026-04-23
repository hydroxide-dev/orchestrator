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

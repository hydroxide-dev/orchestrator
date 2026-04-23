import type { RunResult } from "./types";

type PveClusterResource = {
  vmid?: number;
  type?: string;
};

export class PveApiClient {
  private readonly baseUrl: string;
  private readonly tokenHeader: string;
  private readonly tlsOptions: { rejectUnauthorized?: boolean; ca?: any[] } | undefined;

  constructor(
    private readonly url: string,
    private readonly tokenId: string,
    private readonly tokenSecret: string,
    private readonly skipTlsVerify = false,
    private readonly caFile?: string,
  ) {
    this.baseUrl = `${url.replace(/\/+$/, "")}/api2/json`;
    this.tokenHeader = `PVEAPIToken=${tokenId}=${tokenSecret}`;
    this.tlsOptions = skipTlsVerify
      ? { rejectUnauthorized: false }
      : caFile
        ? { ca: [Bun.file(caFile)] }
        : undefined;
  }

  async getVersion(): Promise<{ version?: string; release?: string; repoid?: string }> {
    const response = await this.requestJson<{ data?: { version?: string; release?: string; repoid?: string } }>("/version");
    return response.data ?? {};
  }

  async listUsedVmids(): Promise<number[]> {
    const data = await this.requestJson<{ data?: PveClusterResource[] }>("/cluster/resources?type=vm");
    const ids = data.data ?? [];
    return ids
      .map((item) => item.vmid)
      .filter((vmid): vmid is number => typeof vmid === "number" && Number.isInteger(vmid) && vmid >= 100);
  }

  async findLowestAvailableVmid(): Promise<number> {
    const used = new Set(await this.listUsedVmids());
    let candidate = 100;
    while (used.has(candidate)) {
      candidate += 1;
    }
    return candidate;
  }

  async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: this.tokenHeader,
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
        ...(this.tlsOptions ? ({ tls: this.tlsOptions } as any) : {}),
      } as RequestInit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Unable to verify the first certificate")) {
        throw new Error(
          [
            "PVE TLS verification failed while calling the API.",
            "This is the Proxmox HTTPS certificate, not the SSH connection.",
            "Either set PVE_SKIP_TLS_VERIFY=true for a lab cluster, or set PVE_CA_FILE to the Proxmox root CA PEM.",
          ].join(" "),
        );
      }
      throw error;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`PVE request failed: ${response.status} ${response.statusText}\n${body}`);
    }

    return (await response.json()) as T;
  }
}

export async function assertPveAuth(client: PveApiClient): Promise<string> {
  const version = await client.getVersion();
  const label = [version.version, version.release, version.repoid].filter(Boolean).join(" ");
  return label || "connected";
}

export function summarizeRunResult(command: string, exitCode: number, stdout: string, stderr: string): RunResult {
  return {
    command,
    exitCode,
    stdout,
    stderr,
  };
}

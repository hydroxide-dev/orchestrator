import { describe, expect, test } from "bun:test";
import { validateComputeFile } from "./compute";

describe("validateComputeFile", () => {
  test("accepts the canonical compute.yaml shape", () => {
    const instance = validateComputeFile({
      version: 1,
      resources: {
        cpu: { cores: 4 },
        ram: { amount: 8192 },
        disk: [
          { id: "boot", type: "boot", size: 16384 },
          { id: "media", type: "storage-slow", size: 262144 },
        ],
        network: {
          ports: ["80:80/http", "443:443/https"],
          bridges: [{ name: "vmbr0", ipv4: "dhcp", ipv6: "slaac" }],
        },
      },
      runtime: {
        os: "hydroxide-dev/image/ubuntu-24.04",
      },
    });

    expect(instance.resources.cpu.cores).toBe(4);
    expect(instance.resources.disk[1]?.id).toBe("media");
    expect(instance.resources.network.bridges[0]?.ipv4).toBe("dhcp");
  });

  test("rejects unsupported versions", () => {
    expect(() =>
      validateComputeFile({
        version: 2,
      }),
    ).toThrow("version must be 1");
  });
});

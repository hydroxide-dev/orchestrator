import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, loadStateConfig } from "./config";

async function writeConfig(value: unknown): Promise<string> {
  const dir = join("/tmp", `hydroxide-config-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "config.json");
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function baseConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pve: {
      url: "https://pve.example.test:8006",
      tokenId: "root@pam!hydroxide",
      tokenSecret: "secret",
      node: "homelab",
      skipTlsVerify: true,
      caFile: null,
    },
    ssh: {
      host: "homelab",
      user: "root",
      port: 22,
      identityFile: null,
      batchMode: true,
      strictHostKeyChecking: false,
    },
    quickshell: {
      template: "local:vztmpl/debian.tar.zst",
      storage: "local-lvm",
      bridge: "vmbr0",
      password: "secret",
      vmid: 9999,
      hostname: "quickshell",
      memory: 1024,
      cores: 2,
      swap: 512,
      unprivileged: true,
    },
    ...extra,
  };
}

describe("loadConfig state paths", () => {
  test("uses default state paths when state is omitted", async () => {
    const config = await loadConfig(await writeConfig(baseConfig()));

    expect(config.stateInstanceConfigDir).toBe("./var/instances");
    expect(config.stateInstancesDb).toBe("./var/instances.sqlite3");
    expect(config.stateEventsDb).toBe("./var/events.sqlite3");
  });

  test("uses explicit state paths", async () => {
    const config = await loadConfig(
      await writeConfig(
        baseConfig({
          state: {
            instanceConfigDir: "/tmp/hydroxide/instances",
            instancesDb: "/tmp/hydroxide/instances.sqlite3",
            eventsDb: "/tmp/hydroxide/events.sqlite3",
          },
        }),
      ),
    );

    expect(config.stateInstanceConfigDir).toBe("/tmp/hydroxide/instances");
    expect(config.stateInstancesDb).toBe("/tmp/hydroxide/instances.sqlite3");
    expect(config.stateEventsDb).toBe("/tmp/hydroxide/events.sqlite3");
  });

  test("loads state paths without resolving unrelated secrets", async () => {
    const config = await loadStateConfig(
      await writeConfig(
        baseConfig({
          pve: {
            url: { $env: "HYDROXIDE_TEST_MISSING_PVE_URL" },
            tokenId: { $env: "HYDROXIDE_TEST_MISSING_PVE_TOKEN_ID" },
            tokenSecret: { $env: "HYDROXIDE_TEST_MISSING_PVE_TOKEN_SECRET" },
            node: "homelab",
            skipTlsVerify: true,
            caFile: null,
          },
        }),
      ),
    );

    expect(config.pveNode).toBe("homelab");
    expect(config.stateEventsDb).toBe("./var/events.sqlite3");
  });
});

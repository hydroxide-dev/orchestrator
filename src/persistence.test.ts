import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { archiveComputeSource, buildInstanceRecord, markInstanceDeleteRequested } from "./compute-store";
import { validateComputeFile } from "./compute";
import { openSqlite } from "./db";
import { createOperation, finishOperation, initEventsDb, listOperations, nowIso, startOperation } from "./events";
import { importImagePlan } from "./images";
import { initInstancesDb, insertInstance, readInstance, updateInstance } from "./instances";
import type { ResolvedImage } from "./types";

async function tempDir(prefix: string): Promise<string> {
  const dir = join("/tmp", `${prefix}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function computeYaml(cpuCores: number): string {
  return [
    "version: 1",
    "resources:",
    "  cpu:",
    `    cores: ${cpuCores}`,
    "  ram:",
    "    amount: 8192",
    "  disk:",
    "    - id: boot",
    "      type: boot",
    "      size: 16384",
    "  network:",
    "    ports:",
    "      - 80:80/http",
    "    bridges:",
    "      - name: vmbr0",
    "        ipv4: dhcp",
    "runtime:",
    "  os: local/test",
    "",
  ].join("\n");
}

const image: ResolvedImage = {
  id: "local/test",
  localPath: "local:iso/test.qcow2",
  downloadUrl: "file:///tmp/test.qcow2",
  source: {
    kind: "local",
    url: "file:///tmp/test.qcow2",
  },
};

describe("compute instance persistence", () => {
  test("creates, updates, and soft-deletes an instance with operation events", async () => {
    const root = await tempDir("hydroxide-persistence");
    const instancesDb = await openSqlite(join(root, "instances.sqlite3"));
    const eventsDb = await openSqlite(join(root, "events.sqlite3"));
    initInstancesDb(instancesDb);
    initEventsDb(eventsDb);

    const uuid = randomUUID();
    const createFile = join(root, "compute-create.yaml");
    await Bun.write(createFile, computeYaml(2));
    const createEvent = createOperation(eventsDb, {
      eventName: "compute.create",
      humanName: "Compute create",
      actor: "test",
      targetInstance: uuid,
      payload: { file: createFile },
    });
    startOperation(eventsDb, createEvent.id);

    const createCompute = validateComputeFile({
      version: 1,
      resources: {
        cpu: { cores: 2 },
        ram: { amount: 8192 },
        disk: [{ id: "boot", type: "boot", size: 16384 }],
        network: { ports: ["80:80/http"], bridges: [{ name: "vmbr0", ipv4: "dhcp" }] },
      },
      runtime: { os: "local/test" },
    });
    const createArchive = await archiveComputeSource(createFile, join(root, "instances"), uuid);
    const created = buildInstanceRecord({
      uuid,
      status: "desired",
      compute: createCompute,
      image,
      archive: createArchive,
      now: nowIso(),
    });
    insertInstance(instancesDb, created);
    finishOperation(eventsDb, createEvent.id, "succeeded");

    const archivedText = await Bun.file(join(root, "instances", uuid, "compute.yaml")).text();
    expect(archivedText).toBe(computeYaml(2));
    expect(readInstance(instancesDb, uuid)?.status).toBe("desired");

    const updateFile = join(root, "compute-update.yaml");
    await Bun.write(updateFile, computeYaml(4));
    const updateEvent = createOperation(eventsDb, {
      eventName: "compute.update",
      humanName: "Compute update",
      actor: "test",
      targetInstance: uuid,
      payload: { file: updateFile },
    });
    startOperation(eventsDb, updateEvent.id);
    const updateCompute = validateComputeFile({
      ...JSON.parse(created.desiredJson),
      resources: {
        ...JSON.parse(created.desiredJson).resources,
        cpu: { cores: 4 },
      },
    });
    const updateArchive = await archiveComputeSource(updateFile, join(root, "instances"), uuid);
    const updated = buildInstanceRecord({
      uuid,
      status: "updated",
      compute: updateCompute,
      image,
      archive: updateArchive,
      now: nowIso(),
      prior: created,
    });
    updateInstance(instancesDb, updated);
    finishOperation(eventsDb, updateEvent.id, "succeeded");

    expect(readInstance(instancesDb, uuid)?.cpuCores).toBe(4);
    expect(readInstance(instancesDb, uuid)?.status).toBe("updated");

    const deleteEvent = createOperation(eventsDb, {
      eventName: "compute.delete",
      humanName: "Compute delete",
      actor: "test",
      targetInstance: uuid,
      payload: { uuid },
    });
    startOperation(eventsDb, deleteEvent.id);
    const deleted = markInstanceDeleteRequested(updated, nowIso());
    updateInstance(instancesDb, deleted);
    finishOperation(eventsDb, deleteEvent.id, "succeeded");

    expect(readInstance(instancesDb, uuid)?.status).toBe("delete_requested");
    expect(readInstance(instancesDb, uuid)?.deletedAt).toBeTruthy();

    const operations = listOperations(eventsDb);
    expect(operations.map((operation) => operation.eventName)).toEqual([
      "compute.create",
      "compute.update",
      "compute.delete",
    ]);
    expect(operations.every((operation) => operation.status === "succeeded")).toBe(true);
    expect(operations.every((operation) => operation.startedAt && operation.finishedAt)).toBe(true);

    instancesDb.close();
    eventsDb.close();
  });
});

describe("image pull operation events", () => {
  test("records finished_at on success and failure_reason on failure", async () => {
    const root = await tempDir("hydroxide-image-events");
    const eventsDb = await openSqlite(join(root, "events.sqlite3"));
    initEventsDb(eventsDb);

    const success = createOperation(eventsDb, {
      eventName: "images.pull",
      humanName: "Images pull",
      actor: "test",
      payload: { imageId: "local/test" },
    });
    startOperation(eventsDb, success.id);
    await importImagePlan(
      {
        id: "local/test",
        localPath: "local:iso/test.qcow2",
        downloadUrl: "file:///tmp/test.qcow2",
        source: { kind: "local", url: "file:///tmp/test.qcow2" },
        force: false,
      },
      async () => {
        throw new Error("runner should not be called for existing image");
      },
      async () => true,
    );
    finishOperation(eventsDb, success.id, "succeeded");

    const failure = createOperation(eventsDb, {
      eventName: "images.pull",
      humanName: "Images pull",
      actor: "test",
      payload: { imageId: "local/fail" },
    });
    startOperation(eventsDb, failure.id);
    try {
      await importImagePlan(
        {
          id: "local/fail",
          localPath: "local:iso/fail.qcow2",
          downloadUrl: "file:///tmp/fail.qcow2",
          source: { kind: "local", url: "file:///tmp/fail.qcow2" },
          force: false,
        },
        async (command) => ({ command, exitCode: 1, stdout: "", stderr: "download failed" }),
        async () => false,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishOperation(eventsDb, failure.id, "failed", message);
    }

    const operations = listOperations(eventsDb);
    expect(operations[0]?.status).toBe("succeeded");
    expect(operations[0]?.finishedAt).toBeTruthy();
    expect(operations[1]?.status).toBe("failed");
    expect(operations[1]?.finishedAt).toBeTruthy();
    expect(operations[1]?.failureReason).toContain("download failed");

    eventsDb.close();
  });
});

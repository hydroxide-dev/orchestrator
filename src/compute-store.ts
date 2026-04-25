import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ComputeInstance, InstanceRecord, InstanceStatus, ResolvedImage } from "./types";

export type ArchivedComputeSource = {
  computePath: string;
  computeSha256: string;
  text: string;
};

export async function archiveComputeSource(
  sourceFile: string,
  instanceConfigDir: string,
  instanceUuid: string,
): Promise<ArchivedComputeSource> {
  const text = await Bun.file(sourceFile).text();
  const instanceDir = join(instanceConfigDir, instanceUuid);
  await mkdir(instanceDir, { recursive: true });
  const computePath = join(instanceDir, "compute.yaml");
  await Bun.write(computePath, text);

  return {
    computePath,
    computeSha256: createHash("sha256").update(text).digest("hex"),
    text,
  };
}

export function buildInstanceRecord(input: {
  uuid: string;
  status: InstanceStatus;
  compute: ComputeInstance;
  image: ResolvedImage;
  archive: ArchivedComputeSource;
  now: string;
  prior?: InstanceRecord;
}): InstanceRecord {
  return {
    uuid: input.uuid,
    name: input.prior?.name,
    vmid: input.prior?.vmid,
    node: input.prior?.node,
    status: input.status,
    computePath: input.archive.computePath,
    computeSha256: input.archive.computeSha256,
    imageId: input.image.id,
    imageLocalPath: input.image.localPath,
    cpuCores: input.compute.resources.cpu.cores,
    ramMb: input.compute.resources.ram.amount,
    desiredJson: JSON.stringify(input.compute),
    createdAt: input.prior?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

export function markInstanceDeleteRequested(record: InstanceRecord, now: string): InstanceRecord {
  return {
    ...record,
    status: "delete_requested",
    updatedAt: now,
    deletedAt: now,
  };
}

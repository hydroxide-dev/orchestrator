import type { Database } from "bun:sqlite";
import type { InstanceRecord, InstanceStatus } from "./types";

type NullableInstanceRow = {
  uuid: string;
  name: string | null;
  vmid: number | null;
  node: string | null;
  status: InstanceStatus;
  compute_path: string;
  compute_sha256: string;
  image_id: string;
  image_local_path: string;
  cpu_cores: number;
  ram_mb: number;
  desired_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function initInstancesDb(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instances (
      uuid TEXT PRIMARY KEY,
      name TEXT NULL,
      vmid INTEGER NULL,
      node TEXT NULL,
      status TEXT NOT NULL,
      compute_path TEXT NOT NULL,
      compute_sha256 TEXT NOT NULL,
      image_id TEXT NOT NULL,
      image_local_path TEXT NOT NULL,
      cpu_cores INTEGER NOT NULL,
      ram_mb INTEGER NOT NULL,
      desired_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT NULL
    );

    CREATE INDEX IF NOT EXISTS instances_status_idx ON instances(status);
    CREATE INDEX IF NOT EXISTS instances_vmid_idx ON instances(vmid);
    CREATE INDEX IF NOT EXISTS instances_node_idx ON instances(node);
  `);
}

function toRecord(row: NullableInstanceRow): InstanceRecord {
  return {
    uuid: row.uuid,
    name: row.name ?? undefined,
    vmid: row.vmid ?? undefined,
    node: row.node ?? undefined,
    status: row.status,
    computePath: row.compute_path,
    computeSha256: row.compute_sha256,
    imageId: row.image_id,
    imageLocalPath: row.image_local_path,
    cpuCores: row.cpu_cores,
    ramMb: row.ram_mb,
    desiredJson: row.desired_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
  };
}

export function insertInstance(db: Database, record: InstanceRecord): void {
  db.query(`
    INSERT INTO instances (
      uuid,
      name,
      vmid,
      node,
      status,
      compute_path,
      compute_sha256,
      image_id,
      image_local_path,
      cpu_cores,
      ram_mb,
      desired_json,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.uuid,
    record.name ?? null,
    record.vmid ?? null,
    record.node ?? null,
    record.status,
    record.computePath,
    record.computeSha256,
    record.imageId,
    record.imageLocalPath,
    record.cpuCores,
    record.ramMb,
    record.desiredJson,
    record.createdAt,
    record.updatedAt,
    record.deletedAt ?? null,
  );
}

export function updateInstance(db: Database, record: InstanceRecord): void {
  db.query(`
    UPDATE instances
    SET
      name = ?,
      vmid = ?,
      node = ?,
      status = ?,
      compute_path = ?,
      compute_sha256 = ?,
      image_id = ?,
      image_local_path = ?,
      cpu_cores = ?,
      ram_mb = ?,
      desired_json = ?,
      updated_at = ?,
      deleted_at = ?
    WHERE uuid = ?
  `).run(
    record.name ?? null,
    record.vmid ?? null,
    record.node ?? null,
    record.status,
    record.computePath,
    record.computeSha256,
    record.imageId,
    record.imageLocalPath,
    record.cpuCores,
    record.ramMb,
    record.desiredJson,
    record.updatedAt,
    record.deletedAt ?? null,
    record.uuid,
  );
}

export function readInstance(db: Database, uuid: string): InstanceRecord | undefined {
  const row = db.query("SELECT * FROM instances WHERE uuid = ?").get(uuid) as NullableInstanceRow | null;
  return row ? toRecord(row) : undefined;
}

export function listInstances(db: Database): InstanceRecord[] {
  return (db.query("SELECT * FROM instances ORDER BY created_at ASC").all() as NullableInstanceRow[]).map(toRecord);
}

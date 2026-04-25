import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { OperationEventName, OperationEventRecord, OperationSource, OperationStatus } from "./types";

type NullableEventRow = {
  id: string;
  event_name: OperationEventName;
  human_name: string;
  actor: string;
  target_service: string | null;
  target_instance: string | null;
  target_node: string | null;
  status: OperationStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  retry_at: string | null;
  retry_count: number;
  failure_reason: string | null;
  payload_json: string;
  source: OperationSource;
};

export type CreateOperationInput = {
  eventName: OperationEventName;
  humanName: string;
  actor: string;
  targetService?: string;
  targetInstance?: string;
  targetNode?: string;
  payload?: unknown;
  source?: OperationSource;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function initEventsDb(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      human_name TEXT NOT NULL,
      actor TEXT NOT NULL,
      target_service TEXT NULL,
      target_instance TEXT NULL,
      target_node TEXT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT NULL,
      finished_at TEXT NULL,
      retry_at TEXT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT NULL,
      payload_json TEXT NOT NULL,
      source TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS events_target_instance_idx ON events(target_instance);
    CREATE INDEX IF NOT EXISTS events_event_name_idx ON events(event_name);
    CREATE INDEX IF NOT EXISTS events_created_at_idx ON events(created_at);
  `);
}

function toRecord(row: NullableEventRow): OperationEventRecord {
  return {
    id: row.id,
    eventName: row.event_name,
    humanName: row.human_name,
    actor: row.actor,
    targetService: row.target_service ?? undefined,
    targetInstance: row.target_instance ?? undefined,
    targetNode: row.target_node ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    retryAt: row.retry_at ?? undefined,
    retryCount: row.retry_count,
    failureReason: row.failure_reason ?? undefined,
    payloadJson: row.payload_json,
    source: row.source,
  };
}

export function createOperation(db: Database, input: CreateOperationInput): OperationEventRecord {
  const record: OperationEventRecord = {
    id: randomUUID(),
    eventName: input.eventName,
    humanName: input.humanName,
    actor: input.actor,
    targetService: input.targetService,
    targetInstance: input.targetInstance,
    targetNode: input.targetNode,
    status: "pending",
    createdAt: nowIso(),
    retryCount: 0,
    payloadJson: JSON.stringify(input.payload ?? {}),
    source: input.source ?? "user",
  };

  db.query(`
    INSERT INTO events (
      id,
      event_name,
      human_name,
      actor,
      target_service,
      target_instance,
      target_node,
      status,
      created_at,
      started_at,
      finished_at,
      retry_at,
      retry_count,
      failure_reason,
      payload_json,
      source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.eventName,
    record.humanName,
    record.actor,
    record.targetService ?? null,
    record.targetInstance ?? null,
    record.targetNode ?? null,
    record.status,
    record.createdAt,
    null,
    null,
    null,
    record.retryCount,
    null,
    record.payloadJson,
    record.source,
  );

  return record;
}

export function startOperation(db: Database, id: string): void {
  db.query("UPDATE events SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?").run(nowIso(), id);
}

export function finishOperation(
  db: Database,
  id: string,
  status: Extract<OperationStatus, "succeeded" | "failed">,
  failureReason?: string,
): void {
  db.query("UPDATE events SET status = ?, finished_at = ?, failure_reason = ? WHERE id = ?").run(
    status,
    nowIso(),
    failureReason ?? null,
    id,
  );
}

export function readOperation(db: Database, id: string): OperationEventRecord | undefined {
  const row = db.query("SELECT * FROM events WHERE id = ?").get(id) as NullableEventRow | null;
  return row ? toRecord(row) : undefined;
}

export function listOperations(db: Database): OperationEventRecord[] {
  return (db.query("SELECT * FROM events ORDER BY created_at ASC").all() as NullableEventRow[]).map(toRecord);
}

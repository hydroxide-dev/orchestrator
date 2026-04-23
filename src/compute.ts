import { parse } from "yaml";
import type {
  ComputeInstance,
  ComputeInstanceBridge,
} from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid compute file: ${path} must be a non-empty string`);
  }
  return value.trim();
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid compute file: ${path} must be a number`);
  }
  return value;
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid compute file: ${path} must be an array`);
  }
  return value;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid compute file: ${path} must be an object`);
  }
  return value;
}

export async function readComputeFile(filePath: string): Promise<ComputeInstance> {
  const text = await Bun.file(filePath).text();
  const parsed = parse(text);
  return validateComputeFile(parsed);
}

export function validateComputeFile(value: unknown): ComputeInstance {
  const root = requireRecord(value, "root");

  if (root.version !== 1) {
    throw new Error("Invalid compute file: version must be 1");
  }

  const resources = requireRecord(root.resources, "resources");
  const cpu = requireRecord(resources.cpu, "resources.cpu");
  const ram = requireRecord(resources.ram, "resources.ram");
  const diskItems = readArray(resources.disk, "resources.disk");
  const network = requireRecord(resources.network, "resources.network");
  const bridgeItems = readArray(network.bridges, "resources.network.bridges");
  const runtime = requireRecord(root.runtime, "runtime");

  return {
    version: 1,
    resources: {
      cpu: {
        cores: asNumber(cpu.cores, "resources.cpu.cores"),
      },
      ram: {
        amount: asNumber(ram.amount, "resources.ram.amount"),
      },
      disk: diskItems.map((disk, index) => {
        const item = requireRecord(disk, `resources.disk[${index}]`);
        return {
          id: asString(item.id, `resources.disk[${index}].id`),
          type: asString(item.type, `resources.disk[${index}].type`),
          size: asNumber(item.size, `resources.disk[${index}].size`),
        };
      }),
      network: {
        ports: readArray(network.ports, "resources.network.ports").map((port, index) =>
          asString(port, `resources.network.ports[${index}]`),
        ),
        bridges: bridgeItems.map((bridge, index) => {
          const item = requireRecord(bridge, `resources.network.bridges[${index}]`);
          const normalized: ComputeInstanceBridge = {
            name: asString(item.name, `resources.network.bridges[${index}].name`),
          };

          if (item.ipv4 != null) {
            normalized.ipv4 = asString(item.ipv4, `resources.network.bridges[${index}].ipv4`);
          }
          if (item.ipv6 != null) {
            normalized.ipv6 = asString(item.ipv6, `resources.network.bridges[${index}].ipv6`);
          }

          return normalized;
        }),
      },
    },
    runtime: {
      os: asString(runtime.os, "runtime.os"),
    },
  };
}

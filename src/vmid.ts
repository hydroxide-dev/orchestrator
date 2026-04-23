export function lowestAvailableVmid(usedVmids: Iterable<number>, floor = 100): number {
  const used = new Set<number>();

  for (const vmid of usedVmids) {
    if (Number.isInteger(vmid) && vmid >= floor) {
      used.add(vmid);
    }
  }

  let candidate = floor;
  while (used.has(candidate)) {
    candidate += 1;
  }

  return candidate;
}

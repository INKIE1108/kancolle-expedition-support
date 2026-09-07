export type NozakiState = {
  startAt: number | null;
  endAt: number | null;
  notifiedAt: number | null;
  updatedAt: number;
};

// updatedAt identifies a user operation. Completion must never make an older run newer.
export function mergeNozaki<T extends NozakiState>(local: T, remote?: T): T {
  if (!remote) return local;
  if (remote.updatedAt > local.updatedAt) return remote;
  if (remote.updatedAt < local.updatedAt) return local;
  if (remote.startAt !== local.startAt || remote.endAt !== local.endAt) return local;
  return { ...local, notifiedAt: local.notifiedAt ?? remote.notifiedAt };
}

export function nextOperationTime(previous: number, now = Date.now()): number {
  return Math.max(now, previous + 1);
}

export function completeNozaki<T extends NozakiState>(current: T, expectedEnd: number, now: number): T {
  if (current.endAt !== expectedEnd || now < expectedEnd || current.notifiedAt) return current;
  return { ...current, notifiedAt: now };
}

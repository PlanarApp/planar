/**
 * The replica in IndexedDB is «best-effort» by default: under disk pressure the browser may wipe it silently
 * (and Safari — after 7 days without visits to a non-installed site). Persistent storage is kept until the user
 * clears it. Chrome grants it to an installed/engaged PWA without a prompt, Firefox asks, Safari 17+ supports it.
 */
export async function persistStorage(): Promise<boolean> {
  try {
    const s = navigator.storage;
    if (!s?.persist) return false;
    return (await s.persisted()) || (await s.persist());
  } catch {
    return false;
  }
}

/** How much the app keeps on the device and whether it is persistent; null — the browser doesn't tell. */
export async function storageInfo(): Promise<{ usage: number; persisted: boolean } | null> {
  try {
    const s = navigator.storage;
    if (!s?.estimate) return null;
    const [{ usage = 0 }, persisted] = await Promise.all([s.estimate(), s.persisted?.() ?? false]);
    return { usage, persisted };
  } catch {
    return null;
  }
}

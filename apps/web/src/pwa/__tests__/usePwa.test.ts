import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const needRefresh = ref(false);
const updateServiceWorker = vi.fn(async () => {});
let opts: { onRegisteredSW?: (u: string, r?: unknown) => void };
vi.mock('../register', () => ({
  useRegisterSW: (o: typeof opts) => ((opts = o), { needRefresh, updateServiceWorker }),
}));

async function load() {
  vi.resetModules();
  const { usePwa } = await import('../usePwa');
  return usePwa();
}
const register = (update: () => Promise<void>, waiting?: object) =>
  opts.onRegisteredSW?.('/sw.js', { update, waiting });

beforeEach(() => {
  needRefresh.value = false;
  updateServiceWorker.mockClear();
});

describe('checkForUpdates', () => {
  it('error without SW', async () => {
    const p = await load();
    expect(await p.checkForUpdates()).toBe('error');
    expect(p.updateState.value).toBe('error');
  });
  it('checking -> current', async () => {
    const p = await load();
    let done!: () => void;
    register(() => new Promise<void>((r) => (done = r)));
    const res = p.checkForUpdates();
    expect(p.updateState.value).toBe('checking');
    done();
    expect(await res).toBe('current');
  });
  it('available via needRefresh or waiting', async () => {
    const p = await load();
    register(async () => {
      needRefresh.value = true;
    });
    expect(await p.checkForUpdates()).toBe('available');
    const q = await load();
    register(async () => {}, {});
    expect(await q.checkForUpdates()).toBe('available');
  });
  it('error on update failure', async () => {
    const p = await load();
    register(() => Promise.reject(new Error('x')));
    expect(await p.checkForUpdates()).toBe('error');
  });
});

describe('auto update', () => {
  it('applies in hidden tab', async () => {
    await load();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    needRefresh.value = true;
    await Promise.resolve();
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });
});

describe('install', () => {
  const fire = () => {
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    window.dispatchEvent(e);
    return e;
  };
  it('unavailable before event', async () => {
    expect(await (await load()).install()).toBe('unavailable');
  });
  it('intercepts event, installs once', async () => {
    const p = await load();
    const e = fire();
    expect(e.defaultPrevented).toBe(true);
    expect(p.canInstall.value).toBe(true);
    expect(await p.install()).toBe('accepted');
    expect(e.prompt).toHaveBeenCalled();
    expect(p.canInstall.value).toBe(false);
  });
  it('appinstalled clears canInstall', async () => {
    const p = await load();
    fire();
    window.dispatchEvent(new Event('appinstalled'));
    expect(p.canInstall.value).toBe(false);
  });
});

describe('environment', () => {
  it('standalone via navigator.standalone', async () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const p = await load();
    expect(p.isStandalone.value).toBe(true);
    delete (navigator as { standalone?: boolean }).standalone;
  });
  it('iOS by user agent', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    );
    expect((await load()).isIos).toBe(true);
  });
});

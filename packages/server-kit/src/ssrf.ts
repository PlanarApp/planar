import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const deny = new BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 3], // 224/4 and above
] as const)
  deny.addSubnet(a, p, 'ipv4');
deny.addAddress('::', 'ipv6');
deny.addAddress('::1', 'ipv6');
for (const [a, p] of [
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  deny.addSubnet(a, p, 'ipv6');

/** ::ffff:a.b.c.d and ::ffff:xxxx:yyyy → a.b.c.d, otherwise the address as is */
function unmap(addr: string): string {
  const a = addr.toLowerCase();
  const d = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (d) return d[1]!;
  const h = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (!h) return addr;
  const n = (parseInt(h[1]!, 16) << 16) | parseInt(h[2]!, 16);
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export const isBlocked = (addr: string): boolean => {
  const a = unmap(addr);
  return deny.check(a, isIP(a) === 6 ? 'ipv6' : 'ipv4');
};

/** WEBHOOKS_ALLOW_HOSTS: host names or CIDRs, comma-separated (read on every attempt). */
function allowed(host: string, addrs: string[]): boolean {
  const items = (process.env.WEBHOOKS_ALLOW_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (items.includes(host)) return true;
  const cidr = new BlockList();
  for (const i of items) {
    const [a, p] = i.split('/');
    const v = isIP(a!);
    if (v && p !== undefined) cidr.addSubnet(a!, Number(p), v === 6 ? 'ipv6' : 'ipv4');
    else if (v) cidr.addAddress(a!, v === 6 ? 'ipv6' : 'ipv4');
  }
  return addrs.every((x) => {
    const u = unmap(x);
    return cidr.check(u, isIP(u) === 6 ? 'ipv6' : 'ipv4');
  });
}

export class BlockedAddress extends Error {
  constructor() {
    super('blocked_address');
  }
}

/** DNS resolution, check of all addresses; returns the verified address for the connection. */
export async function safeAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const list = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  if (!list.length) throw new Error('dns_empty');
  const addrs = list.map((x) => x.address);
  if (!allowed(host, addrs) && addrs.some(isBlocked)) throw new BlockedAddress();
  return { address: list[0]!.address, family: list[0]!.family as 4 | 6 };
}

import { request } from 'node:http';

export type DockerRes = { status: number; body: string };

export type Docker = (
  method: string,
  path: string,
  body?: string | Buffer,
  contentType?: string,
) => Promise<DockerRes>;

/** Docker Engine API over a unix socket. */
export function dockerClient(socketPath: string): Docker {
  return (method, path, body, contentType = 'application/json') =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath,
          method,
          path,
          headers:
            body === undefined
              ? {}
              : { 'content-type': contentType, 'content-length': Buffer.byteLength(body) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
}

/** Minimal ustar archive (enough for putArchive): a directory when data is undefined, else a regular file. */
export function tar(entries: { name: string; data?: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  for (const { name, data } of entries) {
    const h = Buffer.alloc(512);
    const put = (s: string, off: number) => h.write(s, off, 'ascii');
    put(name, 0);
    put(data ? '0000644\0' : '0000755\0', 100);
    put('0000000\0', 108);
    put('0000000\0', 116);
    put((data?.length ?? 0).toString(8).padStart(11, '0') + '\0', 124);
    put(
      Math.floor(Date.now() / 1000)
        .toString(8)
        .padStart(11, '0') + '\0',
      136,
    );
    put('        ', 148); // the checksum is computed with this field as spaces
    put(data ? '0' : '5', 156);
    put('ustar\x0000', 257);
    let sum = 0;
    for (const b of h) sum += b;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    parts.push(h);
    if (data) parts.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

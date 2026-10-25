import net, { type AddressInfo } from 'node:net';

export interface Mail {
  from: string;
  rcpt: string[];
  data: string;
}

/** Письмо в читаемом виде: заголовки (encoded-word), quoted-printable раскрыты. */
export const decoded = (raw: string) => {
  const i = raw.indexOf('\r\n\r\n');
  const head = raw
    .slice(0, i)
    .replace(/=\?UTF-8\?B\?([^?]+)\?=(\r\n )?/g, (_, b) =>
      Buffer.from(b, 'base64').toString('utf8'),
    );
  const body = Buffer.from(
    raw
      .slice(i)
      .replace(/=\r\n/g, '')
      .replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
    'latin1',
  ).toString('utf8');
  return head + body;
};

/** Заглушка SMTP: EHLO/MAIL/RCPT/DATA/QUIT без TLS и AUTH; сохраняет письма. failRcpt — ответить 550 на RCPT. */
export async function smtpStub() {
  const mails: Mail[] = [];
  const stub = {
    mails,
    failRcpt: false,
    port: 0,
    close: () => new Promise<void>((r) => srv.close(() => r())),
  };
  const srv = net.createServer((s) => {
    let cur: Mail = { from: '', rcpt: [], data: '' };
    let inData = false;
    let buf = '';
    const w = (l: string) => s.write(`${l}\r\n`);
    w('220 stub ESMTP');
    s.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (inData) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end < 0) return;
        cur.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        mails.push(cur);
        cur = { from: '', rcpt: [], data: '' };
        inData = false;
        w('250 queued');
      }
      let i: number;
      while (!inData && (i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') w('250 stub');
        else if (cmd === 'MAIL') {
          cur.from = line.slice(10);
          w('250 ok');
        } else if (cmd === 'RCPT') {
          if (stub.failRcpt) w('550 no such user');
          else {
            cur.rcpt.push(line.slice(8));
            w('250 ok');
          }
        } else if (cmd === 'DATA') {
          inData = true;
          w('354 go');
        } else if (cmd === 'QUIT') {
          w('221 bye');
          s.end();
        } else w('250 ok');
        if (inData && buf.includes('\r\n.\r\n')) s.emit('data', Buffer.alloc(0));
      }
    });
    s.on('error', () => {});
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  stub.port = (srv.address() as AddressInfo).port;
  return stub;
}

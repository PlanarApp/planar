// Клиент SDK в отдельном node-процессе: vitest запускает node с --conditions source,
// и зависимости SDK (eventsource-parser) грузятся из src/*.ts, которые node не исполняет.
// Протокол: строка JSON {id, method, params} в stdin → строка {id, result|error} в stdout.
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [url, secret] = process.argv.slice(2);
const client = new Client({ name: 'test', version: '1' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${secret}` } },
  }),
);
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
send({ id: 0, result: client.getServerVersion() });
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  try {
    send({ id, result: await client[method](params) });
  } catch (e) {
    send({ id, error: String(e) });
  }
}

// Raw RESP2 Wire Protocol over node:net (Technology Invariant #3)
import net from 'node:net';

export function encodeRespCommand(args: readonly (string | number)[]): Buffer {
  const parts: string[] = [`*${args.length}\r\n`];
  for (const arg of args) {
    const str = String(arg);
    const byteLen = Buffer.byteLength(str, 'utf8');
    parts.push(`$${byteLen}\r\n${str}\r\n`);
  }
  return Buffer.from(parts.join(''), 'utf8');
}

export function parseRespFrame(buffer: Buffer): { value: string | number | null; bytesConsumed: number } | null {
  if (buffer.length === 0) return null;
  const prefix = String.fromCharCode(buffer[0]);
  const crlfIdx = buffer.indexOf('\r\n');
  if (crlfIdx === -1) return null;

  const headerLine = buffer.subarray(1, crlfIdx).toString('utf8');

  if (prefix === '+') {
    return { value: headerLine, bytesConsumed: crlfIdx + 2 };
  }
  if (prefix === '-') {
    throw new Error(`RESP Error: ${headerLine}`);
  }
  if (prefix === ':') {
    return { value: Number(headerLine), bytesConsumed: crlfIdx + 2 };
  }
  if (prefix === '$') {
    const len = Number(headerLine);
    if (len === -1) {
      return { value: null, bytesConsumed: crlfIdx + 2 };
    }
    const start = crlfIdx + 2;
    const end = start + len;
    if (buffer.length < end + 2) return null;
    const payload = buffer.subarray(start, end).toString('utf8');
    return { value: payload, bytesConsumed: end + 2 };
  }
  throw new Error(`Unsupported RESP frame prefix "${prefix}".`);
}

export class RawRespSocketClient {
  private readonly host: string;
  private readonly port: number;

  constructor(host = '127.0.0.1', port = 6379) {
    this.host = host;
    this.port = port;
  }

  public async sendCommand(args: readonly (string | number)[]): Promise<string | number | null> {
    const payload = encodeRespCommand(args);
    return await new Promise<string | number | null>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });

      socket.on('connect', () => {
        socket.write(payload);
      });

      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const combined = Buffer.concat(chunks);
        try {
          const parsed = parseRespFrame(combined);
          if (parsed) {
            socket.end();
            resolve(parsed.value);
          }
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      });
    });
  }
}

export interface DisposableRespServer {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

export async function startDisposableRespServer(): Promise<DisposableRespServer> {
  const memory = new Map<string, { value: string; expiresAtMs: number | null }>();

  const server = net.createServer((socket) => {
    socket.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      const lines = text.split('\r\n').filter((l) => l.length > 0);
      const args: string[] = [];
      for (let i = 1; i < lines.length; i += 2) {
        if (lines[i].startsWith('$') && i + 1 < lines.length) {
          args.push(lines[i + 1]);
        }
      }
      const cmd = (args[0] ?? '').toUpperCase();

      if (cmd === 'PING') {
        socket.write('+PONG\r\n');
        return;
      }
      if (cmd === 'SET') {
        const key = args[1];
        const val = args[2] ?? '';
        const exFlag = (args[3] ?? '').toUpperCase();
        const ttlSec = exFlag === 'EX' ? Number(args[4]) : null;
        memory.set(key, {
          value: val,
          expiresAtMs: ttlSec ? Date.now() + ttlSec * 1000 : null,
        });
        socket.write('+OK\r\n');
        return;
      }
      if (cmd === 'GET') {
        const key = args[1];
        const entry = memory.get(key);
        if (!entry) {
          socket.write('$-1\r\n');
          return;
        }
        if (entry.expiresAtMs !== null && Date.now() >= entry.expiresAtMs) {
          memory.delete(key);
          socket.write('$-1\r\n');
          return;
        }
        const byteLen = Buffer.byteLength(entry.value, 'utf8');
        socket.write(`$${byteLen}\r\n${entry.value}\r\n`);
        return;
      }
      if (cmd === 'DEL') {
        const key = args[1];
        const existed = memory.delete(key) ? 1 : 0;
        socket.write(`:${existed}\r\n`);
        return;
      }
      socket.write('-ERR unknown command\r\n');
    });
  });

  return await new Promise<DisposableRespServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        host: addr.address,
        port: addr.port,
        close: () =>
          new Promise<void>((resClose, rejClose) =>
            server.close((err) => (err ? rejClose(err) : resClose()))
          ),
      });
    });
  });
}

// EXEC-FOUND-030: Network Interface Binding
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolvePort } from '../../../../packages/config/src/port.ts';
import { classifyBindFailure } from './bind-failure.ts';

export interface BoundAddress {
  readonly host: string;
  readonly port: number;
  readonly server: http.Server;
  close(): Promise<void>;
}

export async function bindNetwork(
  config: { HOST?: string; PORT?: number | string },
  requestListener?: http.RequestListener
): Promise<BoundAddress> {
  const host = config.HOST ?? '127.0.0.1';
  const port = resolvePort({ PORT: config.PORT ?? 0 });
  const server = http.createServer(requestListener ?? ((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  }));

  return await new Promise<BoundAddress>((resolve, reject) => {
    const onError = (err: Error) => {
      server.removeListener('listening', onListening);
      const failure = classifyBindFailure(err);
      const wrapped = new Error(`Bind failed (${failure.kind}): ${failure.message}`);
      (wrapped as { bindFailure?: unknown; code?: string }).bindFailure = failure;
      (wrapped as { code?: string }).code = failure.code;
      reject(wrapped);
    };

    const onListening = () => {
      server.removeListener('error', onError);
      const addr = server.address() as AddressInfo;
      resolve(
        Object.freeze({
          host: addr.address,
          port: addr.port,
          server,
          close: () =>
            new Promise<void>((resClose, rejClose) =>
              server.close((err) => (err ? rejClose(err) : resClose()))
            ),
        })
      );
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

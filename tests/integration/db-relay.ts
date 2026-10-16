import net from 'node:net';

// A TCP relay between the application and PostgreSQL, so the test can cut the database off from
// this one application (dropping open connections and refusing new ones) without stopping the
// shared server other suites are using, then restore it on the same port.
export async function relay(target: { host: string; port: number }) {
  const sockets = new Set<net.Socket>();
  let server: net.Server | undefined;
  let port = 0;
  const open = () => new Promise<void>(resolve => {
    server = net.createServer(client => {
      const upstream = net.connect(target.port, target.host);
      for (const socket of [client, upstream]) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); }
      client.pipe(upstream).pipe(client);
    });
    server.listen(port, '127.0.0.1', () => { port = (server!.address() as net.AddressInfo).port; resolve(); });
  });
  await open();
  return {
    get port() { return port; },
    open,
    async cut() {
      await new Promise<void>(resolve => { server!.close(() => resolve()); for (const socket of sockets) socket.destroy(); });
    },
  };
}

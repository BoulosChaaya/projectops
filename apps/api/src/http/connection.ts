// EXEC-FOUND-035: Connection Acceptance
import type { Socket } from 'node:net';

export interface ConnectionTracker {
  acceptConnection(socket: Socket): void;
  getOpenConnectionCount(): number;
  destroyAll(): void;
}

export function createConnectionTracker(): ConnectionTracker {
  const sockets = new Set<Socket>();

  return Object.freeze({
    acceptConnection(socket: Socket): void {
      sockets.add(socket);
      socket.once('close', () => {
        sockets.delete(socket);
      });
    },
    getOpenConnectionCount(): number {
      return sockets.size;
    },
    destroyAll(): void {
      for (const sock of sockets) {
        sock.destroy();
      }
      sockets.clear();
    },
  });
}

export function acceptConnection(socket: Socket, tracker?: ConnectionTracker): void {
  if (tracker) {
    tracker.acceptConnection(socket);
  }
}

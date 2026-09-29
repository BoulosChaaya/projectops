// EXEC-FOUND-031: Port Allocation
export function resolvePort(config: { PORT?: number | string } | number | string): number {
  const raw = typeof config === 'object' && config !== null ? config.PORT : config;
  if (raw === undefined || raw === '') {
    return 3000;
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`Invalid port "${text}": must be an integer between 0 and 65535.`);
  }
  const port = Number(text);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Port ${port} is out of range (0..65535).`);
  }
  return port;
}

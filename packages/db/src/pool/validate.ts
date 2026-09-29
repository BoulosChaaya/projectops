// EXEC-DB-010: Connection Validation
import type { DatabaseConnection } from '../connection/connect.ts';

export async function validateConnection(connection: DatabaseConnection): Promise<boolean> {
  if (!connection || !connection.isOpen()) {
    return false;
  }
  try {
    const res = await connection.query<{ ok: number }>('SELECT 1 AS ok');
    return Array.isArray(res.rows) && res.rows.length === 1 && Number(res.rows[0].ok) === 1;
  } catch {
    return false;
  }
}

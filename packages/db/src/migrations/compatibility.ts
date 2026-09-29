// EXEC-DB-047: Application/Schema Compatibility
export interface SchemaCompatibilityMatrix {
  readonly appVersion: string;
  readonly supportedSchemaVersions: readonly string[];
}

export function applicationSchemaCompatibility(
  matrix: SchemaCompatibilityMatrix,
  currentSchemaVersion: string | null
): { compatible: boolean; reason?: string } {
  if (!currentSchemaVersion) {
    return Object.freeze({ compatible: false, reason: 'No schema migrations have been applied.' });
  }
  if (!matrix.supportedSchemaVersions.includes(currentSchemaVersion)) {
    return Object.freeze({
      compatible: false,
      reason: `Application ${matrix.appVersion} requires schema in [${matrix.supportedSchemaVersions.join(
        ', '
      )}], found ${currentSchemaVersion}.`,
    });
  }
  return Object.freeze({ compatible: true });
}

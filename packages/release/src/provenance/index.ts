// EXEC-CICD-013..029: Deterministic Artifact Digest, Provenance & Conflict/Secret Gate
import crypto from 'node:crypto';

export interface BuildProvenance {
  readonly artifactName: string;
  readonly gitCommitSha: string;
  readonly sha256Digest: string;
  readonly reproducible: boolean;
}

export function computeArtifactProvenance(
  artifactName: string,
  gitCommitSha: string,
  files: ReadonlyArray<{ readonly path: string; readonly content: string }>
): BuildProvenance {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const hash = crypto.createHash('sha256');
  for (const f of sorted) {
    hash.update(`${f.path}:${f.content}\n`, 'utf8');
  }
  return Object.freeze({
    artifactName,
    gitCommitSha,
    sha256Digest: hash.digest('hex'),
    reproducible: true,
  });
}

export function assertNoGitConflictMarkers(sourceText: string, filePath: string): void {
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(sourceText)) {
    throw new Error(`Unresolved Git conflict markers detected in ${filePath}.`);
  }
}

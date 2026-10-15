import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type ProjectRequest, type Session } from '../../api.ts';
import type { Row } from './record-card.tsx';
import type { CollectionPath } from './sections.ts';

export type Collection =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly rows: readonly Row[] }
  | { readonly state: 'failed'; readonly message: string };

export interface Workspace {
  readonly id: string;
  readonly project: ProjectRequest;
  readonly session: Session;
  /** Replace the project after a write that returns it (edits, estimate, lifecycle actions). */
  setProject(project: ProjectRequest): void;
  /** The page-level status line (#message). */
  report(message: string): void;
  /** A failed page-level action: its message on the status line, and the reload offer after a conflict. */
  failed(error: unknown): void;
  /** Offer "Reload project" when a write was rejected because the record changed (409). */
  conflict(error: unknown): void;
  /** A write to this project. Every successful write refreshes the history, which records it. */
  write<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T>;
  collection(path: CollectionPath): Collection;
  load(path: CollectionPath): Promise<void>;
  /** Bumped after each successful write; the history section reloads when it changes. */
  readonly writes: number;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw Error('useWorkspace outside the project workspace.');
  return workspace;
}

/** A section's own status line, with the same conflict handling as the page. */
export function useSectionStatus(): [string, (text: string) => void, (error: unknown) => void] {
  const [text, setText] = useState('');
  const { conflict } = useWorkspace();
  return [text, setText, error => { setText((error as Error).message); conflict(error); }];
}

/**
 * A section's commands: one at a time, the outcome on the section's status line, and the
 * section's records reloaded after success so the page shows what the server stored.
 */
export function useSectionAction(...reload: CollectionPath[]) {
  const [status, setStatus, failure] = useSectionStatus();
  const [busy, setBusy] = useState(false);
  const { load } = useWorkspace();
  async function run(work: () => Promise<unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setStatus('');
    try {
      await work();
      setStatus(done);
      await Promise.all(reload.map(path => load(path)));
      return true;
    } catch (error) { failure(error); return false; }
    finally { setBusy(false); }
  }
  return { status, busy, run };
}

export function WorkspaceProvider({ id, project, session, setProject, report, onConflict, children }: {
  id: string; project: ProjectRequest; session: Session;
  setProject: (project: ProjectRequest) => void; report: (message: string) => void; onConflict: () => void;
  children: ReactNode;
}) {
  const [collections, setCollections] = useState<Partial<Record<CollectionPath, Collection>>>({});
  const [writes, setWrites] = useState(0);
  // A newer load of the same collection wins over a slower, older response.
  const generations = useRef<Partial<Record<CollectionPath, number>>>({});

  const load = useCallback(async (path: CollectionPath) => {
    const generation = (generations.current[path] ?? 0) + 1;
    generations.current[path] = generation;
    setCollections(current => ({ ...current, [path]: { state: 'loading' } }));
    try {
      const rows = await api.projectCollection<Row>(id, path);
      if (generations.current[path] === generation) setCollections(current => ({ ...current, [path]: { state: 'ready', rows } }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) window.location.assign('/projectops/login');
      if (generations.current[path] === generation) setCollections(current => ({ ...current, [path]: { state: 'failed', message: (error as Error).message } }));
    }
  }, [id]);

  const write = useCallback(async <T,>(method: 'POST' | 'PUT', path: string, body: unknown) => {
    try {
      const result = await api.projectWrite<T>(session.csrfToken, method, id, path, body);
      setWrites(count => count + 1);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) window.location.assign('/projectops/login');
      throw error;
    }
  }, [id, session.csrfToken]);

  const conflict = (error: unknown) => { if (error instanceof ApiError && error.status === 409) onConflict(); };
  const value: Workspace = {
    id, project, session, setProject, report, write, load, writes, conflict,
    failed: error => { report((error as Error).message); conflict(error); },
    collection: path => collections[path] ?? { state: 'loading' },
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

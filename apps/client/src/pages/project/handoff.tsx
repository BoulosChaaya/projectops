import { useState } from 'react';
import { useWorkspace } from './context.tsx';

const FILENAME = /^attachment; filename="(projectops-project-[A-Za-z0-9_-]+\.json)"$/;

/**
 * The internal export downloads only a response that is exactly the expected JSON attachment;
 * anything else (an error page, a proxy's response) is reported instead of saved.
 */
export function Handoff() {
  const { id } = useWorkspace();
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const path = encodeURIComponent(id);

  async function download() {
    setBusy(true); setFailed(false); setStatus('Preparing internal project export…');
    let url: string | undefined;
    try {
      const response = await fetch(`/projectops/project-requests/${path}/export`, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (!response.ok) {
        if (response.status === 401) window.location.assign('/projectops/login');
        const data = await response.json().catch(() => undefined) as { message?: unknown } | undefined;
        throw Error(typeof data?.message === 'string' ? data.message : 'Project export unavailable.');
      }
      const match = FILENAME.exec(response.headers.get('content-disposition') ?? '');
      if (!match || !response.headers.get('content-type')?.startsWith('application/json')) throw Error('Project export unavailable.');
      url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = match[1]!;
      document.body.append(link); link.click(); link.remove();
      setStatus('Project information exported (internal use).');
    } catch (error) {
      setStatus((error as Error).message || 'Project export unavailable.');
      setFailed(true);
    } finally {
      if (url) { const done = url; setTimeout(() => URL.revokeObjectURL(done), 1000); }
      setBusy(false);
    }
  }

  return (
    <section id="handoff" className="ws-section" aria-labelledby="handoff-title">
      <h2 id="handoff-title">Export and handoff</h2>
      <p className="ws-help">Project information is an internal operator export. The delivery summary includes only accepted deliverables, active client notes and active handoff documents.</p>
      <div className="ws-actions">
        <button id="export-project" type="button" className="button button-secondary" onClick={download} disabled={busy}>Export project information</button>
        <a id="view-delivery-summary" className="button button-quiet" href={`/projectops/projects/${path}/delivery-summary`}>View delivery summary</a>
      </div>
      <p id="export-status" className="ws-status" role="status" aria-live="polite">{status}</p>
      {failed && <button id="retry-export" type="button" className="button button-quiet" onClick={download} disabled={busy}>Retry export</button>}
    </section>
  );
}

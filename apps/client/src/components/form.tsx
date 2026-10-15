import { cloneElement, useId, type ReactElement } from 'react';
import '../styles/forms.css';

/**
 * A labelled control. The label text alone is the accessible name (screen readers and tests find
 * the control by it); the hint is linked as its description, so it is read without renaming it.
 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement<{ id?: string; 'aria-describedby'?: string }> }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {cloneElement(children, { id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) })}
      {hint && <span className="field-hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

export type Notice = { readonly tone: 'success' | 'error'; readonly text: string } | null;

/** Result of the last action on a form, announced to screen readers. */
export function FormStatus({ notice }: { notice: Notice }) {
  return (
    <p className={`form-status${notice ? ` form-status-${notice.tone}` : ''}`} role="status" aria-live="polite">
      {notice?.text ?? ''}
    </p>
  );
}

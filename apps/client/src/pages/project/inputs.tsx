import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Field } from '../../components/form.tsx';

// Labelled controls for the workspace forms. The label text is each control's accessible name,
// which the browser journeys use to find it, so labels stay exactly as written by each section.

export function Input({ label, hint, ...props }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <Field label={label} hint={hint}><input {...props} /></Field>;
}

export function TextArea({ label, ...props }: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Field label={label}><textarea rows={3} {...props} /></Field>;
}

export type Choice = string | { readonly value: string; readonly label: string };
export function Select({ label, choices, extra, ...props }: { label: string; choices: readonly Choice[]; extra?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="field-with-extra">
      <Field label={label}>
        <select {...props}>
          {choices.map(choice => typeof choice === 'string'
            ? <option key={choice} value={choice}>{choice}</option>
            : <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      </Field>
      {extra}
    </div>
  );
}

export function Check({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="field-check"><input type="checkbox" {...props} /> {label}</label>;
}

export const LEVELS = ['low', 'medium', 'high'] as const;

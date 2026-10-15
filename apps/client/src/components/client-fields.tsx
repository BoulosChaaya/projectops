import type { ClientInput, ProjectOpsClient } from '../api.ts';
import { Field } from './form.tsx';

/** Name, contact and email, shared by the create and edit forms. */
export function ClientFields({ client }: { client?: ProjectOpsClient }) {
  return (
    <>
      <Field label="Client name"><input name="name" defaultValue={client?.name ?? ''} required maxLength={120} /></Field>
      <Field label="Contact name"><input name="contactName" defaultValue={client?.contactName ?? ''} maxLength={120} /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={client?.email ?? ''} maxLength={254} /></Field>
    </>
  );
}

const optional = (value: FormDataEntryValue | null) => String(value ?? '').trim() || undefined;

export function clientInput(form: HTMLFormElement): ClientInput {
  const data = new FormData(form);
  return { name: String(data.get('name') ?? ''), contactName: optional(data.get('contactName')), email: optional(data.get('email')) };
}

import { useEffect, useState } from 'react';
import { api, type Session } from './api.ts';

export type SessionState =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly session: Session }
  | { readonly state: 'failed'; readonly message: string };

/** Loads the signed-in operator; without a session it goes to the sign-in page. */
export function useSession(): [SessionState, (session: Session) => void] {
  const [value, setValue] = useState<SessionState>({ state: 'loading' });
  useEffect(() => {
    let current = true;
    api.session().then(session => {
      if (!current) return;
      if (!session) window.location.assign('/projectops/login');
      else setValue({ state: 'ready', session });
    }).catch((error: Error) => { if (current) setValue({ state: 'failed', message: error.message }); });
    return () => { current = false; };
  }, []);
  return [value, session => setValue({ state: 'ready', session })];
}

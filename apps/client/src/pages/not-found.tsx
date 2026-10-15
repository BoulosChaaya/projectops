import { AppShell } from '../components/app-shell.tsx';

export function NotFoundPage() {
  return (
    <AppShell session={null} title="Page not found">
      <p className="page-lede">This address isn’t part of ProjectOps. <a href="/projectops">Go to the dashboard</a>.</p>
    </AppShell>
  );
}

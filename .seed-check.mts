import { ProjectOpsMemorySqlExecutor, ProjectOpsRepository, applyProjectOpsMigrations } from './packages/projectops/src/index.ts';
import { seedDemoAgency } from './packages/projectops/src/demo-seed.ts';
const sql = new ProjectOpsMemorySqlExecutor(); await applyProjectOpsMigrations(sql);
const t = Date.now(); await seedDemoAgency(sql, new Date()); console.log('seeded in', Date.now() - t, 'ms');
const repo = new ProjectOpsRepository(sql);
const d = await repo.getDashboard(undefined, new Date().toISOString());
console.log(JSON.stringify({ rows: d.rows.map(r => [r.title, r.status]), overdue: d.overdueWorkCount, money: d.financeTotalsByCurrency }, null, 0).slice(0, 900));
console.log('activities', (await repo.listProjectActivities('bakery-ordering')).length);

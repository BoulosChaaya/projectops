import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { operatorFixture } from './operator-fixture.ts';
import { ProjectOpsRepository, ProjectOpsConnectionSqlExecutor, projectOpsPoolConnection, type ProjectOpsSqlExecutor } from '../../packages/projectops/src/index.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';
import { seedDashboard, assertDashboardContract, NOW, FUTURE } from '../dashboard-fixture.ts';

async function fixture(pool: Pool) {
  const client = await pool.connect();try { await migrateProjectOpsPostgres(client,await loadProjectOpsPostgresMigrations()); }finally{client.release();}
  const sql=new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool));const repo=new ProjectOpsRepository(sql);
  await seedDashboard(repo);return {sql,repo};
}

test('Operational dashboard PostgreSQL snapshot matches memory rules, filters, exact currencies and restart source persistence',async()=>{
  await operatorFixture(async(url,pool)=>{
    const {repo,sql}=await fixture(pool);const statements:string[]=[];
    const counted=new ProjectOpsRepository({query:async statement=>{statements.push(statement.sql);return sql.query(statement);}});
    const before=(await pool.query('SELECT row_to_json(p) AS row FROM projectops_project_requests p ORDER BY id')).rows;
    await assertDashboardContract(counted);assert.ok(statements.every(s=>s.includes('WITH dashboard_scope')));
    assert.ok(statements.every(s=>!s.includes('FOR UPDATE')));
    assert.deepEqual((await pool.query('SELECT row_to_json(p) AS row FROM projectops_project_requests p ORDER BY id')).rows,before);
    const first=await repo.getDashboard({status:'delivered'},NOW);
    const restartedPool=new Pool({connectionString:url});try{
      const restarted=new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(restartedPool)));
      assert.deepEqual(await restarted.getDashboard({status:'delivered'},NOW),first);
    }finally{await restartedPool.end();}
    await repo.completeProjectTask('approved','a-before',{expectedRevision:1,completedBy:'operator',completedAtIso:NOW});
    await repo.completeProjectMilestone('approved','before',{expectedRevision:1,completedAtIso:NOW});
    assert.equal((await repo.getDashboard({status:'approved'},NOW)).overdueWorkCount,1);
    await repo.reopenProjectTask('approved','a-before',{expectedRevision:2,reopenedAtIso:NOW});
    await repo.reopenProjectMilestone('approved','before',{expectedRevision:2,reopenedAtIso:NOW});
    assert.equal((await repo.getDashboard({status:'approved'},NOW)).overdueWorkCount,3);
    await repo.editProjectTask('approved','a-before',{title:'Rescheduled',priority:'medium',dueAtIso:NOW,expectedRevision:3},NOW);
    await repo.editProjectMilestone('approved','before',{title:'Rescheduled',dueAtIso:FUTURE,expectedRevision:3},NOW);
    assert.equal((await repo.getDashboard({status:'approved'},NOW)).overdueWorkCount,1);
    await repo.editProjectMilestone('approved','before',{title:'Clear date',expectedRevision:4},NOW);
    assert.equal((await repo.getDashboard({status:'approved'},NOW)).rows[0].nextUpcomingMilestone!.id,'future');
    await repo.markProjectInvoicePaid('approved','i1',NOW);
    const paid=await repo.getDashboard({status:'approved'},NOW);assert.equal(paid.issuedInvoices,3);assert.equal(paid.financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents,'2000000000');
    await repo.approveProjectExpense('approved','submitted',{decidedBy:'operator',decidedAtIso:NOW});
    assert.equal((await repo.getDashboard({status:'approved'},NOW)).financeTotalsByCurrency.USD.submittedExpenseAmountCents,'0');
    await repo.transitionProjectRequest('approved','cancelled',NOW);assert.equal((await repo.getDashboard({q:'project approved'},NOW)).rows.length,0);
    assert.equal((await repo.listProjectInvoices('approved')).length,5);
    await repo.transitionProjectRequest('delivered','archived',NOW);assert.equal((await repo.getDashboard({status:'delivered'},NOW)).rows.length,0);
    assert.equal((await repo.listProjectTasks('delivered')).length,6);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM projectops_schema_migrations')).rows[0].n,7);
  });
});

function historyBarrier(source: ProjectOpsSqlExecutor, rollback=false) {
  let opened!:()=>void, release!:()=>void;const reached=new Promise<void>(r=>opened=r), resume=new Promise<void>(r=>release=r);
  const wrap=(sql:ProjectOpsSqlExecutor):ProjectOpsSqlExecutor=>({
    transaction:run=>sql.transaction!(nested=>run(wrap(nested))),
    query:async statement=>{if(statement.sql.trim().startsWith('INSERT INTO projectops_project_activities')){opened();await resume;if(rollback)throw Error('Required history rejected');}return sql.query(statement);},
  });
  return {sql:wrap(source),reached,release};
}

test('Read-only dashboard sees committed business/history together without locking, and rollback preserves the previous result', {timeout:30000},async()=>{
  await operatorFixture(async(_url,pool)=>{
    const {repo,sql}=await fixture(pool);await pool.query("SET statement_timeout='5s'");
    for(const [id,kind] of [['in_progress','task'],['on_hold','milestone'],['approved','payment'],['estimated','cancel'],['delivered','rollback']] as const){
      const before=await repo.getDashboard({q:'project '+id},NOW);const revisions=(await repo.getProjectRequest(id))!.revision;
      const barrier=historyBarrier(sql,kind==='rollback');const writer=new ProjectOpsRepository(barrier.sql).withHistory({actor:'winning-operator',clock:()=>NOW});
      const command=kind==='milestone'?writer.completeProjectMilestone(id,'before',{expectedRevision:1,completedAtIso:NOW}):kind==='payment'?writer.markProjectInvoicePaid(id,'i1',NOW):kind==='cancel'?writer.transitionProjectRequest(id,'cancelled',NOW):writer.completeProjectTask(id,'a-before',{expectedRevision:1,completedAtIso:NOW,completedBy:'operator'});
      const outcome=command.then(value=>({value}),error=>({error}));
      await barrier.reached;
      try {assert.deepEqual(await repo.getDashboard({q:'project '+id},NOW),before);}
      finally{barrier.release();}
      const result=await outcome;const after=await repo.getDashboard({q:'project '+id},NOW);const activities=await repo.listProjectActivities(id);
      if(kind==='rollback'){assert.match((result as any).error.message,/Required history rejected/);assert.deepEqual(after,before);assert.equal(activities.length,0);continue;}
      assert.ok('value' in result);assert.equal(activities.length,1);assert.equal(activities[0].actor,'winning-operator');
      if(kind==='cancel'){assert.equal(after.rows.length,0);assert.equal(activities[0].eventType,'status_changed');}
      else {
        assert.equal(after.rows[0].latestActivitySummary,activities[0].summary);
        assert.equal(after.rows[0].latestActivityAtIso,NOW);
        if(kind==='payment'){assert.equal(after.issuedInvoices,before.issuedInvoices-1);assert.equal(after.financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents,'2000000000');}
        else assert.equal(after.overdueWorkCount,before.overdueWorkCount-1);
        assert.equal((await repo.getProjectRequest(id))!.revision,revisions);
      }
    }
  });
});

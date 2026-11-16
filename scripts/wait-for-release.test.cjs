const test = require('node:test');
const assert = require('node:assert/strict');
const waitForRelease = require('./wait-for-release.cjs');
const sha = 'b'.repeat(40);
const completed = extra => ({ id: 7, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', html_url: 'https://github.com/example/repo/actions/runs/7', ...extra });
const published = () => ['Publish backend image', 'Publish frontend image'].map(name => ({ name, status: 'completed', conclusion: 'success' }));
function fixture({ runs = [completed()], jobs = published(), event = 'workflow_dispatch', ref = 'refs/heads/main', payload = {}, timeoutMs = 90_000 } = {}) {
  let calls = 0, clock = 0, jobReads = 0;
  const outputs = [], sleeps = [], logs = [];
  const options = {
    sha, timeoutMs, now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms; },
    context: { eventName: event, ref, repo: { owner: 'example', repo: 'repo' }, payload },
    core: { setOutput: (...args) => outputs.push(args), info: text => logs.push(text) },
    github: {
      rest: { actions: {
        listWorkflowRuns: async input => { assert.equal(input.workflow_id, 'ci.yml'); assert.equal(input.head_sha, sha); assert.equal(input.event, 'push'); assert.equal(input.branch, 'main'); return { data: { workflow_runs: [runs[Math.min(calls++, runs.length - 1)]].filter(Boolean) } }; },
        listJobsForWorkflowRun() {},
      } },
      paginate: async (method, input) => { jobReads++; assert.equal(input.run_id, 7); assert.equal(input.filter, 'latest'); return jobs; },
    },
  };
  return { options, outputs, sleeps, logs, jobReads: () => jobReads };
}

test('manual deployment waits for main push CI and publishes no SHA before both images succeed', async () => {
  const f = fixture({ runs: [null, completed({ status: 'in_progress', conclusion: null }), completed()] });
  await waitForRelease(f.options);
  assert.deepEqual(f.sleeps, [30_000, 30_000]); assert.deepEqual(f.outputs, [['sha', sha], ['ci_run_id', '7']]); assert.equal(f.jobReads(), 1);
});
test('automatic deployment validates the triggering CI run and both image jobs', async () => {
  const f = fixture({ event: 'workflow_run', payload: { workflow_run: completed() } });
  await waitForRelease(f.options); assert.equal(f.sleeps.length, 0); assert.equal(f.outputs[0][1], sha);
});
test('failed or cancelled CI is rejected before producing a deployment SHA', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    const f = fixture({ runs: [completed({ conclusion })] }); await assert.rejects(waitForRelease(f.options), /no deployment performed/);
    assert.deepEqual(f.outputs, []); assert.equal(f.jobReads(), 0); assert.deepEqual(f.sleeps, []);
  }
});
test('a green CI with skipped, missing or failed image publication cannot deploy', async () => {
  for (const jobs of [[], published().slice(0, 1), published().map(job => ({ ...job, conclusion: 'skipped' })), published().map(job => ({ ...job, conclusion: 'failure' }))]) {
    const f = fixture({ jobs }); await assert.rejects(waitForRelease(f.options), /CI did not publish/); assert.deepEqual(f.outputs, []);
  }
});
test('wrong revision, PR checks and the wrong automatic run are never accepted', async () => {
  for (const run of [completed({ head_sha: 'a'.repeat(40) }), completed({ event: 'pull_request' }), completed({ head_branch: 'feature' })]) {
    const f = fixture({ runs: [run], timeoutMs: 1000 }); await assert.rejects(waitForRelease(f.options), /Timed out/); assert.deepEqual(f.outputs, []);
  }
  const f = fixture({ event: 'workflow_run', payload: { workflow_run: completed({ id: 8 }) }, timeoutMs: 1000 });
  await assert.rejects(waitForRelease(f.options), /Timed out/); assert.deepEqual(f.outputs, []);
});
test('manual non-main refs and invalid automatic triggers are rejected without reading CI', async () => {
  for (const extra of [{ ref: 'refs/heads/feature' }, { event: 'workflow_run', payload: { workflow_run: completed({ event: 'pull_request' }) } }, { event: 'workflow_run', payload: { workflow_run: completed({ head_sha: 'a'.repeat(40) }) } }, { event: 'push' }]) {
    const f = fixture(extra); await assert.rejects(waitForRelease(f.options)); assert.deepEqual(f.outputs, []); assert.equal(f.jobReads(), 0); assert.deepEqual(f.logs, []);
  }
  const f = fixture(); await assert.rejects(waitForRelease({ ...f.options, sha: 'main' }), /Invalid/);
});
test('waiting for an unfinished CI has a bounded deadline and never enters deployment', async () => {
  const f = fixture({ runs: [completed({ status: 'in_progress', conclusion: null })], timeoutMs: 45_000 });
  await assert.rejects(waitForRelease(f.options), /Timed out/); assert.deepEqual(f.sleeps, [30_000, 15_000]); assert.deepEqual(f.outputs, []);
});

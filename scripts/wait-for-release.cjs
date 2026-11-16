const IMAGE_JOBS = ['Publish backend image', 'Publish frontend image'];

module.exports = async function waitForRelease({
  github, context, core, sha,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 20 * 60_000,
  intervalMs = 30_000,
}) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid production commit SHA');
  if (context.eventName === 'workflow_dispatch') {
    if (context.ref !== 'refs/heads/main') throw new Error('Manual production deployment must use main');
  } else if (context.eventName === 'workflow_run') {
    const run = context.payload.workflow_run;
    if (run?.event !== 'push' || run.head_branch !== 'main' || run.head_sha !== sha || run.conclusion !== 'success') {
      throw new Error('Automatic deployment requires a successful main push CI run');
    }
  } else {
    throw new Error('Unsupported production deployment trigger');
  }

  const deadline = now() + timeoutMs;
  const { owner, repo } = context.repo;
  let previous = '';
  while (now() < deadline) {
    const { data } = await github.rest.actions.listWorkflowRuns({
      owner, repo, workflow_id: 'ci.yml', event: 'push', branch: 'main', head_sha: sha, per_page: 20,
    });
    const run = data.workflow_runs.find(candidate =>
      candidate.head_sha === sha && candidate.event === 'push' && candidate.head_branch === 'main' &&
      (context.eventName !== 'workflow_run' || candidate.id === context.payload.workflow_run.id));
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`CI for ${sha} ended with ${run.conclusion}; no deployment performed. ${run.html_url}`);
      const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
        owner, repo, run_id: run.id, filter: 'latest', per_page: 100,
      });
      for (const name of IMAGE_JOBS) {
        if (!jobs.some(job => job.name === name && job.status === 'completed' && job.conclusion === 'success')) {
          throw new Error(`CI did not publish ${name}; no deployment performed. ${run.html_url}`);
        }
      }
      core.setOutput('sha', sha);
      core.setOutput('ci_run_id', String(run.id));
      core.info(`Verified CI and both SHA-tagged images for ${sha}. ${run.html_url}`);
      return;
    }
    const state = run?.status || 'not started';
    if (state !== previous) {
      core.info(`Waiting for main CI and image publication for ${sha}: ${state}`);
      previous = state;
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  throw new Error(`Timed out waiting for CI and SHA-tagged images for ${sha}; no deployment performed`);
};

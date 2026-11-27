// Read source identity from the image itself, with support for older local candidates.
const { existsSync, readFileSync } = require('node:fs');

try {
  const [image] = JSON.parse(readFileSync(0, 'utf8'));
  const labels = image.Config?.Labels || {};
  let commit = labels['org.opencontainers.image.revision'];
  let state = labels['io.postiz.worktree'];
  const recordPath = process.argv[2];
  if (!state && existsSync(recordPath)) {
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (record.imageId === image.Id) {
      commit = record.source?.commit;
      state = record.source?.worktreeState;
    }
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(image.Id) ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit) ||
      !['dirty', 'clean'].includes(state)) {
    throw new Error('missing matching build provenance; rebuild the local candidate');
  }
  console.log(image.Id, commit, state);
} catch (error) {
  console.error('build-postiz: cannot identify local candidate:', error.message);
  process.exitCode = 2;
}

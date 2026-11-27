// Offline Docker/ACR doubles for build-pipeline.test.sh. Keep tags mutable and IDs immutable.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const [cli, ...args] = process.argv.slice(2);
const opt = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const command = args.join(' ');
fs.appendFileSync(process.env.STUB_CALLS, [cli, ...args].join(' ') + '\n');
const fail = (message, code = 1) => { console.error(message); process.exit(code); };
if (cli === 'kubectl') process.exit(0);

const stateFile = cli === 'az' ? process.env.STUB_ACR_IMAGES : process.env.STUB_LOCAL_IMAGES;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8') || '{}');
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
const newId = () => 'sha256:' + randomBytes(32).toString('hex');
// An editor changes the live checkout after the first build has started.
if (process.env.STUB_EDIT_SOURCE && args.includes('build') && !args.includes('imagetools')) {
  fs.writeFileSync(process.env.STUB_EDIT_SOURCE, 'edited during build\n');
}
const isBuild = (cli === 'az' && ['build', 'run'].includes(args[1])) ||
  (cli === 'docker' && args[0] === 'build');
if (isBuild) {
  const context = args.at(-1);
  if (fs.existsSync(path.join(context, '.git'))) fail('live Git checkout supplied to builder');
  if (process.env.STUB_EXPECT_SOURCE &&
      fs.readFileSync(path.join(context, 'apps/backend/src/main.ts'), 'utf8').trim() !== process.env.STUB_EXPECT_SOURCE) {
    fail('source changed between layers');
  }
}
if (cli === 'az') {
  if (args[0] !== 'acr') fail('unexpected command: ' + command);
  if (args[1] === 'show') console.log('resolved.azurecr.io');
  else if (args[1] === 'login') process.exit(0);
  else if (args[1] === 'repository' && args[2] === 'untag') {
    delete state[opt('--image')];
    save();
  } else if (args[1] === 'repository' && args[2] === 'show') {
    if (process.env.STUB_AZ_AUTH_FAIL) fail('Authentication required.');
    if (process.env.STUB_AZ_QUERY_ERROR) fail(process.env.STUB_AZ_QUERY_ERROR);
    const image = opt('--image');
    if (!state[image]) fail("ERROR: The tag '" + image.split(':')[1] + "' could not be found.");
    console.log(state[image]);
  } else if (args[1] === 'build') {
    const file = opt('--file');
    if (!fs.existsSync(file)) fail('unable to find ' + file);
    if (path.basename(file) === process.env.STUB_FAIL_LAYER) fail('interrupted cache rebuild');
    state[opt('--image')] = newId();
    save();
  } else if (args[1] === 'run') {
    if (!fs.existsSync(path.join(args.at(-1), opt('--file')))) fail('missing ACR task definition');
    if (process.env.SENTRY_AUTH_TOKEN?.trim()) {
      if (opt('--set-secret') !== 'sentryToken=@-' ||
          fs.readFileSync(0, 'utf8') !== process.env.SENTRY_AUTH_TOKEN) fail('incorrect secret input');
    } else if (args.includes('--set-secret')) fail('unexpected secret');
    console.log(process.env.STUB_TASK_DIGEST || newId());
  } else fail('unexpected command: ' + command);
} else if (cli === 'docker') {
  const ref = args.at(-1);
  if (args[0] === 'version') console.log('linux/arm64');
  else if (args[0] === 'build') {
    if (process.env.STUB_DOCKER_FAIL || path.basename(opt('--file')) === process.env.STUB_FAIL_LAYER) fail('build failed');
    const id = newId();
    const labels = {};
    args.forEach((arg, i) => {
      if (arg === '--label') {
        const [key, value] = args[i + 1].split('=');
        labels[key] = value;
      }
    });
    const platform = opt('--platform') || process.env.DOCKER_DEFAULT_PLATFORM || 'linux/arm64';
    const [os, architecture] = platform.split('/');
    state[id] = state[opt('--tag')] = {
      Id: id,
      Os: os,
      Architecture: architecture,
      Config: { Labels: labels },
    };
    if (args.includes('--iidfile')) fs.writeFileSync(opt('--iidfile'), id);
    save();
  } else if (args[0] === 'tag') {
    if (!state[args[1]]) fail('unknown source image');
    state[ref] = state[args[1]];
    save();
  } else if (args[0] === 'push') {
    if (!state[ref]) fail('unknown push target');
    // A competing run re-tags the public destination on this daemon before our push.
    if (process.env.STUB_COMPETING_TAG) {
      state[process.env.STUB_COMPETING_TAG] = { Id: 'sha256:' + 'b'.repeat(64) };
      save();
    }
    const registry = JSON.parse(fs.readFileSync(process.env.STUB_ACR_IMAGES, 'utf8') || '{}');
    const digest = 'sha256:' + createHash('sha256').update(state[ref].Id).digest('hex');
    registry[ref.slice(ref.indexOf('/') + 1)] = digest;
    registry[digest] = state[ref].Id;
    fs.writeFileSync(process.env.STUB_ACR_IMAGES, JSON.stringify(registry));
    console.log(ref.split(':').at(-1) + ': digest: ' + digest + ' size: 123');
  } else if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'create') {
    const registry = JSON.parse(fs.readFileSync(process.env.STUB_ACR_IMAGES, 'utf8'));
    const digest = ref.split('@')[1];
    if (!registry[digest] || !args.includes('--prefer-index=false')) fail('expected an existing manifest digest');
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--tag') {
        const tag = args[i + 1];
        registry[tag.slice(tag.indexOf('/') + 1)] = digest;
      }
    }
    fs.writeFileSync(process.env.STUB_ACR_IMAGES, JSON.stringify(registry));
  } else if (args[0] === 'image' && args[1] === 'rm') {
    delete state[ref];
    save();
  } else if (args[0] === 'image' && args[1] === 'inspect') {
    const image = state[ref];
    if (!image) fail('No such image: ' + ref);
    const formats = { '{{.Id}}': image.Id, '{{.Architecture}}': image.Architecture, '{{.Os}}': image.Os };
    console.log(args.includes('--format') ? formats[opt('--format')] : JSON.stringify([image]));
  } else fail('unexpected command: ' + command);
}

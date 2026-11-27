import { resultBoundary, type ReportFault } from './browser-result-fault';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

// Only the platform, provider inventory and paired command's observable result are controlled.
// Use a dedicated Gateway database and Temporal namespace with postId/organizationId search attributes.
export async function deliveryFixture(postizUrl: string, fault?: ReportFault) {
  const dir = await mkdtemp(join(tmpdir(), 'browser-schedule-'));
  const cli = join(dir, 'paired fixture');
  const token = randomUUID();
  const desktopToken = randomUUID();
  const alias = randomUUID();
  const loginRequiredAlias = randomUUID();
  const processes: ChildProcess[] = [];
  const source = resolve(process.env.BROWSER_TRACER_SAU!);
  const python = process.env.BROWSER_TRACER_PYTHON!;
  const provider = createServer((_, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        data: {
          list: [
            { id: alias, name: 'Bound test profile' },
            { id: loginRequiredAlias, name: 'Expired test login' },
          ],
        },
      })
    );
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const providerUrl =
    'http://127.0.0.1:' + (provider.address() as { port: number }).port;
  const gatewayPort = Number(process.env.BROWSER_TRACER_GATEWAY_PORT);
  const gateway = 'http://127.0.0.1:' + gatewayPort;
  const boundary = fault ? await resultBoundary(gateway, fault) : undefined;
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    PYTHONPATH: [join(source, 'gateway'), join(source, 'cli-service')].join(
      ':'
    ),
    GATEWAY_DATABASE_URL: process.env.BROWSER_TRACER_GATEWAY_DB!,
    GATEWAY_INTERNAL_TOKEN: token,
    GATEWAY_DESKTOP_TOKEN: desktopToken,
    SAU_DESKTOP_TOKEN: desktopToken,
    POSTIZ_INTERNAL_URL: postizUrl,
    SAU_GATEWAY_URL: boundary?.url || gateway,
    ...(fault && { GATEWAY_RESULT_TIMEOUT_SECONDS: '5' }),
    SAU_CLI_PATH: cli,
    SAU_DEV_CHROME_ALIASES: alias,
    BITBROWSER_API_BASE: providerUrl,
    BITBROWSER_API_KEY: 'fixture',
    ...(process.env.BROWSER_TRACER_REDIS_URL
      ? {
          GATEWAY_REDIS_URL: process.env.BROWSER_TRACER_REDIS_URL,
          GATEWAY_REDIS_CHANNEL: alias,
        }
      : {}),
  };
  async function stop() {
    await writeFile(join(dir, 'release'), '');
    for (const proc of processes.reverse()) {
      if (proc.exitCode !== null || proc.signalCode) continue;
      const closed = once(proc, 'close');
      proc.kill();
      await closed;
    }
    boundary?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
  try {
    await writeFile(
      cli,
      `#!${python}
import json, os, sys, time
from pathlib import Path
here = Path(__file__).parent
if sys.argv[1:] == ['--version']:
    print('sau 0.1.0')
    sys.exit()
if sys.argv[1:3] == ['media', 'predownload'] and '--wait' in sys.argv: sys.exit(0)
with (here/'calls').open('a') as f:
    print(json.dumps(sys.argv[1:]), file=f)
def instagram_event(status, **fields):
    print("SAU-EVENT", os.environ["SAU_EVENT_NONCE"], json.dumps(dict(status=status, **fields)), flush=True)
if sys.argv[1] == 'instagram' and '--no-publish' not in sys.argv:
    instagram_event('processing')
for i in range(600):
    if (here/'release').exists(): break
    time.sleep(.1)
else: sys.exit(9)
if '--profile-id=${loginRequiredAlias}' in sys.argv: sys.exit(10)
if sys.argv[1] == 'instagram':
    if '--no-publish' in sys.argv:
        instagram_event('prepared')
    elif sys.argv[2] == 'upload-video' and (here/'ig-unknown').exists():
        sys.exit(9)
    else:
        kind = 'p' if sys.argv[2] == 'upload-note' else 'reel'
        instagram_event('published', post_id='SC_33', post_url=f'https://www.instagram.com/{kind}/SC_33/')
elif '--no-publish' in sys.argv:
    print('素材已上传，发布前检查已通过；已停止，未点击发布按钮。')
elif sys.argv[1] in ('rednote', 'xiaohongshu'):
    label = {'rednote':'Rednote', 'xiaohongshu':'Xiaohongshu'}[sys.argv[1]]
    if sys.argv[2] == 'upload-note':
        images = sys.argv[sys.argv.index('--images') + 1:]
        count = next((i for i, arg in enumerate(images) if arg.startswith('--')), len(images))
        print(f'{label} note upload submitted: {count} images')
    else:
        print(f'{label} video upload submitted: fixture')
else:
    if sys.argv[2] == 'upload-note':
        images = sys.argv[sys.argv.index('--images') + 1:]
        count = next((i for i, arg in enumerate(images) if arg.startswith('--')), len(images))
        print(f'TikTok note upload submitted: {count} images')
    else:
        print('TikTok video upload submitted: fixture')
    print('video_id: 999999')
`,
      { mode: 0o700 }
    );
    execFileSync(python, ['-m', 'sau_gateway', 'migrate'], { env, cwd: dir });
    const launch = (args: string[]) => {
      const proc = spawn(python, ['-m', ...args], {
        env,
        cwd: dir,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      proc.stderr!.on('data', (data) => {
        if (process.env.BROWSER_TRACER_DEBUG) process.stderr.write(data);
      });
      processes.push(proc);
      return proc;
    };
    launch([
      'sau_gateway',
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      String(gatewayPort),
    ]);
    await eventually(async () => (await fetch(gateway + '/health-check')).ok);
    return {
      gateway,
      token,
      alias,
      loginRequiredAlias,
      stop,
      boundary,
      startDesktop: () => {
        const child = launch(['sau_worker', 'run']);
        return async () => {
          if (child.exitCode !== null || child.signalCode) return;
          const stopped = once(child, 'close');
          child.kill('SIGKILL');
          await stopped;
        };
      },
      release: () => writeFile(join(dir, 'release'), ''),
      unknownInstagramVideo: () => writeFile(join(dir, 'ig-unknown'), ''),
      calls: async () =>
        (await readFile(join(dir, 'calls'), 'utf8').catch(() => ''))
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as string[]),
      api: async (path: string, body?: unknown, desktop = false) => {
        const r = await fetch(gateway + path, {
          method: body ? 'POST' : 'GET',
          headers: {
            authorization: 'Bearer ' + (desktop ? desktopToken : token),
            'content-type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, data: await r.json() };
      },
    };
  } catch (e) {
    await stop();
    throw e;
  }
}

export async function eventually(
  predicate: () => Promise<boolean>,
  timeout = 30000
) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      if (await predicate()) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for browser delivery');
}

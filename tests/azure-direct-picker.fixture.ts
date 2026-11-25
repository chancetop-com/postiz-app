import { build } from 'esbuild';
import type { Page } from 'playwright';
import type { startDirectUploadApp } from './azure-direct-app.fixture';

export async function bundleDirectUploadPage(entryPoint: string) {
  const result = await build({
    logLevel: 'error',
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    write: false,
    tsconfig: 'apps/frontend/tsconfig.json',
    jsx: 'automatic',
    platform: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    loader: { '.css': 'empty' },
  });
  return result.outputFiles[0].text;
}

export const bundleDirectPicker = () =>
  bundleDirectUploadPage('tests/azure-direct-browser.fixture.tsx');

export async function openDirectUploadPage(
  page: Page,
  app: Awaited<ReturnType<typeof startDirectUploadApp>>,
  bundle: string,
  settings = ''
) {
  await page
    .context()
    .grantPermissions(['local-network-access'], { origin: app.baseUrl });
  await page.goto(app.baseUrl + '/azure-test-page?' + settings);
  await page.evaluate(
    ({ auth, org }) => {
      sessionStorage.setItem('auth', auth);
      sessionStorage.setItem('showorg', org);
    },
    { auth: app.sessions[app.merchantId], org: app.merchantId }
  );
  await page.addScriptTag({ content: bundle });
}

export { openDirectUploadPage as openDirectPicker };

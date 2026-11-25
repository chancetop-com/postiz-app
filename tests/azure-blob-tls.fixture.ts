import { execFileSync } from 'node:child_process';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

// The project's Node 22 runtime provides these APIs beyond its bundled @types/node.
const { getCACertificates, setDefaultCACertificates } = tls as typeof tls & {
  getCACertificates(type: 'default'): string[];
  setDefaultCACertificates(certificates: string[]): void;
};

export function createLoopbackCertificate() {
  const pem = execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=' + randomUUID(),
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      '-',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const key = pem.slice(0, pem.indexOf('-----BEGIN CERTIFICATE-----'));
  const cert = pem.slice(key.length);
  return { key, cert };
}

// Trust this suite's ephemeral loopback certificate in the real SDK and fetch.
export function createBlobTestTls() {
  const { key, cert } = createLoopbackCertificate();
  const previous = getCACertificates('default');
  setDefaultCACertificates([...previous, cert]);
  return { key, cert, restoreTrust: () => setDefaultCACertificates(previous) };
}

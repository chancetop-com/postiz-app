import { createServer, request } from 'node:http';
import { once } from 'node:events';

export type ReportFault =
  | 'before-report'
  | 'lost-ack'
  | 'offline-orchestrator'
  | 'gateway-offline'
  | 'claim-lost';

/** Interrupt the real desktop's TCP connection on either side of the Gateway commit. */
export async function resultBoundary(gateway: string, fault: ReportFault) {
  let reports = 0;
  let polls = 0;
  let claimsLost = 0;
  const server = createServer((req, res) => {
    const result = req.url === '/publish-task/result';
    if (req.url === '/publish-task/claim') polls++;
    if (result) reports++;
    if (
      fault === 'gateway-offline' &&
      reports &&
      req.url?.startsWith('/internal/occurrences/')
    ) {
      res.writeHead(503).end();
      return;
    }
    if (result && (fault === 'before-report' || fault === 'gateway-offline')) {
      req.resume();
      res.destroy();
      return;
    }
    const forwarded = request(
      gateway + req.url,
      {
        method: req.method,
        headers: req.headers,
      },
      (reply) => {
        if (
          req.url === '/publish-task/claim' &&
          fault === 'claim-lost' &&
          reply.statusCode === 200
        ) {
          let body = '';
          reply.on('data', (chunk) => {
            body += chunk;
          });
          reply.on('end', () => {
            if (JSON.parse(body).task) {
              claimsLost++;
              res.destroy();
            } else
              res
                .writeHead(200, { 'content-type': 'application/json' })
                .end(body);
          });
          return;
        }
        if (result && fault === 'lost-ack' && reply.statusCode === 200) {
          reply.resume();
          reply.on('end', () => res.destroy());
        } else {
          res.writeHead(reply.statusCode!, reply.headers);
          reply.pipe(res);
        }
      }
    );
    forwarded.on('error', () => res.destroy());
    res.on('close', () => forwarded.destroy());
    req.pipe(forwarded);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: 'http://127.0.0.1:' + (server.address() as { port: number }).port,
    counts: () => ({ reports, polls, claimsLost }),
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

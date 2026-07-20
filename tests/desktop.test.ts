import http from 'node:http';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  findOpenPort,
  isSafeExternalUrl,
  isTrustedAppUrl,
  waitForHttp,
} = require('../desktop/app/runtime-utils.cjs') as {
  findOpenPort: (hostname?: string) => Promise<number>;
  isSafeExternalUrl: (candidate: string) => boolean;
  isTrustedAppUrl: (candidate: string, appOrigin: string) => boolean;
  waitForHttp: (url: string, timeoutMs?: number) => Promise<void>;
};

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('Electron desktop runtime', () => {
  it('reserves a loopback port and waits for the local app', async () => {
    const port = await findOpenPort();
    expect(port).toBeGreaterThan(0);
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ready');
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    await expect(waitForHttp(`http://127.0.0.1:${port}`, 2_000)).resolves.toBeUndefined();
  });

  it('keeps navigation on the private app origin', () => {
    const origin = 'http://127.0.0.1:43123';
    expect(isTrustedAppUrl(`${origin}/api/files`, origin)).toBe(true);
    expect(isTrustedAppUrl('http://127.0.0.1:43124/', origin)).toBe(false);
    expect(isTrustedAppUrl('https://example.com/', origin)).toBe(false);
    expect(isTrustedAppUrl('not a URL', origin)).toBe(false);
  });

  it('opens only HTTPS links outside the desktop window', () => {
    expect(isSafeExternalUrl('https://doi.org/10.1000/example')).toBe(true);
    expect(isSafeExternalUrl('http://example.com/')).toBe(false);
    expect(isSafeExternalUrl('file:///C:/secret.txt')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
  });
});

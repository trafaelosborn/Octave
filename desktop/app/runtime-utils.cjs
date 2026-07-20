const http = require('node:http');
const net = require('node:net');

async function findOpenPort(hostname = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, hostname, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await requestOnce(url);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  const detail = lastError instanceof Error ? ` ${lastError.message}` : '';
  throw new Error(`Octave's local server did not start in time.${detail}`);
}

function isTrustedAppUrl(candidate, appOrigin) {
  try {
    return new URL(candidate).origin === appOrigin;
  } catch {
    return false;
  }
}

function isSafeExternalUrl(candidate) {
  try {
    return new URL(candidate).protocol === 'https:';
  } catch {
    return false;
  }
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      if (response.statusCode && response.statusCode < 500) resolve();
      else reject(new Error(`Local server returned HTTP ${response.statusCode ?? 'unknown'}.`));
    });
    request.setTimeout(1_500, () => request.destroy(new Error('Local server request timed out.')));
    request.once('error', reject);
  });
}

module.exports = { findOpenPort, isSafeExternalUrl, isTrustedAppUrl, waitForHttp };

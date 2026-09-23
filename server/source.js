import https from 'node:https';

// Native HTTPS keeps connections alive and allows slow system DNS lookups to
// complete. Node's default fetch connect timeout can expire before Windows DNS.
const agent = new https.Agent({ keepAlive: true, maxSockets: 1, timeout: 65_000 });

export function sourceRequest(url, options) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { agent, method: options.method, headers: options.headers, signal: options.signal }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2_000_000) { response.destroy(new Error('A resposta do SCORA excedeu o limite esperado.')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

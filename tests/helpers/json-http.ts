import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

/** Shared real HTTP transport for account acceptance; never replaces a server or database. */
export function jsonRequest(
  origin: string,
  route: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise<{ status: number; headers: IncomingHttpHeaders; data: ReturnType<typeof JSON.parse> }>(
    (resolve, reject) => {
      const call = httpRequest(
        new URL(route, origin),
        {
          method: options.method ?? 'GET',
          headers: {
            'content-type': 'application/json',
            ...(payload === undefined ? {} : { 'content-length': String(Buffer.byteLength(payload)) }),
            ...options.headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.once('error', reject);
          res.once('aborted', () => reject(new Error('Test HTTP response interrupted')));
          res.on('end', () => {
            try {
              const content = Buffer.concat(chunks).toString();
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                data: content ? JSON.parse(content) : null,
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      call.setTimeout(15000, () => call.destroy(new Error('Test HTTP timeout')));
      call.once('error', reject);
      call.end(payload);
    },
  );
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { HTTP_CONTRACTS, ApiErrorSchema, API_VERSION } from '../packages/contracts/src/http';
import { C2S, S2C, PROTOCOL_VERSION, NET_ERROR_CODES, MAX_CLIENT_MESSAGE_BYTES } from '../shared/protocol';
import { ModeRulesSchema, ModeOutcomeSchema } from '../packages/contracts/src/modes';

const paths: Record<string, unknown> = {};
for (const item of HTTP_CONTRACTS) {
  const parameters: unknown[] = item.path.includes('{id}')
    ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }]
    : [];
  if ('query' in item) {
    const query = z.toJSONSchema(item.query);
    for (const [name, schema] of Object.entries(query.properties ?? {}))
      parameters.push({ name, in: 'query', required: false, schema });
  }
  if (item.operationId === 'logout')
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    });
  paths[item.path] = {
    [item.method]: {
      operationId: item.operationId,
      ...(parameters.length ? { parameters } : {}),
      ...('body' in item
        ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(item.body) } } } }
        : {}),
      responses: {
        ['successStatus' in item ? String(item.successStatus) : '200']: {
          description: 'Service-specific success envelope; implemented by the corresponding business task',
          ...('response' in item
            ? {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['ok', 'data', 'requestId'],
                      additionalProperties: false,
                      properties: {
                        ok: { const: true },
                        data: z.toJSONSchema(item.response),
                        requestId: { type: 'string', minLength: 1 },
                      },
                    },
                  },
                },
              }
            : {}),
        },
        '400': {
          description: 'Invalid request',
          content: { 'application/json': { schema: z.toJSONSchema(ApiErrorSchema) } },
        },
      },
    },
  };
}
const content = `${JSON.stringify({ openapi: '3.1.0', info: { title: 'Pengzhuang boundary contracts (controllers not yet implemented)', version: API_VERSION }, paths, components: { schemas: { ModeRules: z.toJSONSchema(ModeRulesSchema), ModeOutcome: z.toJSONSchema(ModeOutcomeSchema) } }, 'x-websocket': { protocol: PROTOCOL_VERSION, c2s: C2S, s2c: S2C, errors: NET_ERROR_CODES, maxClientMessageBytes: MAX_CLIENT_MESSAGE_BYTES } }, null, 2)}\n`;
const filename = path.resolve('docs/engineering/contracts.openapi.json');
if (process.argv.includes('--check')) {
  if (!existsSync(filename) || readFileSync(filename, 'utf8') !== content) {
    console.error('Contract documentation is stale');
    process.exitCode = 1;
  }
} else {
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, content);
}

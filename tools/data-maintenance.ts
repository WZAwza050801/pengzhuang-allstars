import { open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Database } from '../packages/persistence/src/database';
import { sqlState } from '../packages/persistence/src/transactions';
import { createBundledEconomyConfiguration } from '../config/economy';
import { DEFAULT_DATA } from '../shared/data';
import { PlayerData } from '../server/accounts/player-data';
import { Assets } from '../server/accounts/assets';
import { ApiError } from '../server/api/http';
import { DataAudit } from '../server/maintenance/audit';
import { DataRepairs } from '../server/maintenance/repairs';
import { parseMaintenance, RepairPlanSchema, repairHash } from '../server/maintenance/repair-plan';

const commands: Record<string, readonly string[]> = {
  'audit-user': ['user'],
  'audit-match': ['match'],
  'audit-users': ['after', 'limit'],
  'audit-matches': ['after', 'limit'],
  'audit-orphans': ['limit'],
  prepare: ['kind', 'case', 'reason', 'user', 'match', 'currency', 'delta', 'out'],
  apply: ['file', 'sha256'],
};
function argumentsOf(args: string[]) {
  const [command, ...rest] = args;
  if (!Object.hasOwn(commands, command)) throw new ApiError('INVALID_REQUEST', 400);
  const flags: Record<string, string> = Object.create(null);
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i].slice(2),
      value = rest[i + 1];
    if (
      !rest[i].startsWith('--') ||
      !commands[command].includes(name) ||
      name in flags ||
      !value ||
      value.startsWith('--')
    )
      throw new ApiError('INVALID_REQUEST', 400);
    flags[name] = value;
  }
  return { command, flags };
}
function required(flags: Record<string, string>, key: string) {
  if (!flags[key]) throw new ApiError('INVALID_REQUEST', 400);
  return flags[key];
}
function limitOf(value: string | undefined) {
  if (value === undefined) return 20;
  if (!/^[1-9]\d{0,2}$/.test(value) || Number(value) > 100) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}
async function readPlan(file: string) {
  const handle = await open(file, 'r');
  try {
    const size = 65536,
      stat = await handle.stat();
    if (!stat.isFile() || stat.size > size) throw new ApiError('INVALID_REQUEST', 400);
    const buffer = Buffer.alloc(size + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > size) throw new ApiError('INVALID_REQUEST', 400);
    let value: unknown;
    try {
      value = JSON.parse(buffer.toString('utf8', 0, used));
    } catch {
      throw new ApiError('INVALID_REQUEST', 400);
    }
    const draft = parseMaintenance(
      z.strictObject({ plan: RepairPlanSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
      value,
    );
    if (draft.sha256 !== repairHash(draft.plan)) throw new ApiError('INVALID_REQUEST', 400);
    return draft;
  } finally {
    await handle.close();
  }
}
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
async function main() {
  let db: Database | undefined;
  try {
    if (process.argv.length === 3 && process.argv[2] === '--help') {
      print({
        commands,
        credential: 'MAINTENANCE_DATABASE_URL',
        auditExitCodes: { healthyPage: 0, findings: 2, error: 1 },
        planFormat: 1,
      });
      return 0;
    }
    const { command, flags } = argumentsOf(process.argv.slice(2));
    const connectionString = process.env.MAINTENANCE_DATABASE_URL;
    if (!connectionString) throw new ApiError('INVALID_REQUEST', 400);
    db = new Database({ connectionString, max: 2 });
    const audit = new DataAudit(db);
    if (command.startsWith('audit-')) {
      let result;
      if (command === 'audit-user') result = await audit.user(required(flags, 'user'));
      else if (command === 'audit-match') result = await audit.match(required(flags, 'match'));
      else if (command === 'audit-orphans') result = await audit.orphans(limitOf(flags.limit));
      else {
        const options = { ...(flags.after ? { after: flags.after } : {}), limit: limitOf(flags.limit) };
        result = command === 'audit-users' ? await audit.users(options) : await audit.matches(options);
      }
      print(result);
      return ('items' in result ? result.items.some((item) => item.findings.length > 0) : result.findings.length > 0)
        ? 2
        : 0;
    }
    const policy = createBundledEconomyConfiguration().policy;
    const players = new PlayerData(db, policy, DEFAULT_DATA);
    const assets = new Assets(db, players.initialize, () => ({ policy, data: DEFAULT_DATA }));
    const repairs = new DataRepairs(db, assets);
    if (command === 'prepare') {
      const input: Record<string, string> = {
        kind: required(flags, 'kind'),
        caseId: required(flags, 'case'),
        reason: required(flags, 'reason'),
      };
      for (const [flag, field] of [
        ['user', 'userId'],
        ['match', 'matchId'],
        ['currency', 'currency'],
        ['delta', 'delta'],
      ])
        if (flags[flag] !== undefined) input[field] = flags[flag];
      const file = path.resolve(required(flags, 'out'));
      const draft = await repairs.prepare(input);
      await writeFile(file, `${JSON.stringify(draft, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      print({ file, id: draft.plan.id, sha256: draft.sha256, preview: draft.plan.preview });
    } else {
      const reviewed = required(flags, 'sha256');
      const draft = await readPlan(required(flags, 'file'));
      print(await repairs.apply(draft.plan, reviewed));
    }
    return 0;
  } catch (error) {
    const state = sqlState(error);
    const code =
      error instanceof ApiError
        ? error.code
        : state === '42501' || state === 'EACCES' || state === 'EPERM'
          ? 'FORBIDDEN'
          : state === 'EEXIST' || state === '23505'
            ? 'CONFLICT'
            : state === 'ENOENT'
              ? 'NOT_FOUND'
              : ['40001', '40P01', '55P03', '57014', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(
                    state ?? '',
                  ) || state?.startsWith('08')
                ? 'UNAVAILABLE'
                : 'INTERNAL_ERROR';
    // Never print SQL errors, connection strings, filesystem paths or untrusted exception messages.
    process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
    return 1;
  } finally {
    await db?.close();
  }
}
process.exitCode = await main();

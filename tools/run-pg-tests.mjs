import { execFile as callbackExec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

const exec = promisify(callbackExec);
const config = JSON.parse(readFileSync(new URL('../config/postgres-image.json', import.meta.url), 'utf8'));
const host = process.env.PG_TEST_DOCKER_HOST ?? 'unix:///var/run/docker.sock';
const env = { ...process.env };
for (const key of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGOPTIONS',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGPASSFILE',
])
  delete env[key];
const docker = (...args) => exec('docker', [`--host=${host}`, ...args], { env, maxBuffer: 1048576 });
const name = `pengzhuang-test-${randomUUID()}`;
const password = randomBytes(32).toString('base64url');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'allstars-pg-test-'));
const binaryDirectory = process.env.PG_TEST_BIN_DIR ? path.resolve(process.env.PG_TEST_BIN_DIR) : null;
const cluster = path.join(temporary, 'cluster');
const native = (binary, args) => {
  const executable = path.join(binaryDirectory, `${binary}${process.platform === 'win32' ? '.exe' : ''}`);
  if (binary === 'pg_ctl')
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { env, cwd: temporary, stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve({ stdout: '' }) : reject(new Error('Test PostgreSQL control command failed')),
      );
    });
  return exec(executable, args, {
    env,
    cwd: temporary,
    maxBuffer: 1048576,
    timeout: 60000,
  });
};
let started = false;
let stage = 'startup';
try {
  let port;
  if (binaryDirectory) {
    const version = (await native('postgres', ['--version'])).stdout.trim();
    if (!new RegExp(`PostgreSQL\\) ${config.major}\\.`).test(version))
      throw new Error('Test PostgreSQL major version mismatch');
    const passwordFile = path.join(temporary, 'password');
    writeFileSync(passwordFile, password, { mode: 0o600 });
    stage = 'initdb';
    await native('initdb', [
      '-D',
      cluster,
      '-U',
      'pgtest',
      '--encoding=UTF8',
      '--locale=C',
      '--auth=scram-sha-256',
      `--pwfile=${passwordFile}`,
    ]);
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', resolve);
    });
    port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    stage = 'native server start';
    await native('pg_ctl', [
      '-D',
      cluster,
      '-l',
      path.join(temporary, 'postgres.log'),
      '-w',
      '-t',
      '30',
      '-o',
      `-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=20 -c jit=off`,
      'start',
    ]);
    started = true;
    const admin = new Pool({
      host: '127.0.0.1',
      port,
      user: 'pgtest',
      password,
      database: 'postgres',
      connectionTimeoutMillis: 3000,
    });
    try {
      await admin.query('CREATE DATABASE pengzhuang_test');
    } finally {
      await admin.end();
    }
    console.log(`Isolated ${version} native cluster ready on loopback`);
  } else {
    await exec(
      'docker',
      [
        `--host=${host}`,
        'run',
        '--rm',
        '-d',
        '--name',
        name,
        '-p',
        '127.0.0.1::5432',
        '-e',
        'POSTGRES_PASSWORD',
        '-e',
        'POSTGRES_DB=pengzhuang_test',
        '-e',
        'POSTGRES_USER=pgtest',
        config.image,
      ],
      { env: { ...env, POSTGRES_PASSWORD: password }, maxBuffer: 1048576 },
    );
    started = true;
    const mapped = (await docker('port', name, '5432/tcp')).stdout.trim();
    port = mapped.match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (!port) throw new Error('Test database port unavailable');
  }
  const url = `postgresql://pgtest:${password}@127.0.0.1:${port}/pengzhuang_test`;
  stage = 'database readiness';
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 500 });
    try {
      await pool.query('SELECT 1');
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      await pool.end();
    }
  }
  if (!ready) throw new Error('Test PostgreSQL readiness failed');
  const runId = randomUUID();
  const marker = new Pool({ connectionString: url, connectionTimeoutMillis: 1000 });
  try {
    // Server-side format quotes the database identifier and the bound marker literal for this DDL.
    const command = (
      await marker.query(
        "SELECT format('ALTER DATABASE %I SET pengzhuang.fixture_id = %L',current_database(),$1::text) AS command",
        [runId],
      )
    ).rows[0].command;
    await marker.query(command);
  } finally {
    await marker.end();
  }
  const fixtures = path.join(temporary, 'fixtures');
  mkdirSync(fixtures, { recursive: true });
  stage = 'integration test launch';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve('node_modules/vitest/vitest.mjs'), 'run', '--project', 'integration', ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          APP_ENV: 'test',
          TEST_DATABASE_URL: url,
          PG_TEST_TMP_DIR: fixtures,
          PG_TEST_RUN_ID: runId,
        },
      },
    );
    child.once('error', reject);
    child.once('exit', (value) => resolve(value ?? 1));
  });
  process.exitCode = code;
} catch (error) {
  // exec errors can include command environment; do not print the raw child error.
  console.error(
    `Isolated PostgreSQL test failed at ${stage}; check local Docker or PG_TEST_BIN_DIR and integration output`,
  );
  if (stage === 'initdb' && typeof error?.stderr === 'string')
    console.error(error.stderr.replaceAll(password, '[redacted]'));
  process.exitCode = 1;
} finally {
  let cleaned = false;
  try {
    if (binaryDirectory) {
      if (existsSync(path.join(cluster, 'postmaster.pid')))
        await native('pg_ctl', ['-D', cluster, '-w', '-t', '30', '-m', 'fast', 'stop']);
    } else if (started) await docker('rm', '-f', name);
    cleaned = true;
  } catch {
    console.error('Test PostgreSQL cleanup failed; temporary cluster retained for diagnosis');
    process.exitCode = 1;
  }
  if (
    cleaned &&
    path.dirname(temporary) === path.resolve(os.tmpdir()) &&
    path.basename(temporary).startsWith('allstars-pg-test-')
  ) {
    try {
      rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      console.error('Test PostgreSQL temporary directory cleanup failed after bounded retries');
      process.exitCode = 1;
    }
  }
}

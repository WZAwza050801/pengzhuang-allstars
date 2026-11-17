import { execFile as callbackExec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const exec = promisify(callbackExec);
const config = JSON.parse(readFileSync(new URL('../config/postgres-image.json', import.meta.url),'utf8'));
const host = process.env.PG_TEST_DOCKER_HOST ?? 'unix:///var/run/docker.sock';
const env = {...process.env};
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key];
const docker = (...args) => exec('docker',[`--host=${host}`,...args],{env,maxBuffer:1048576});
const name = `pengzhuang-test-${randomUUID()}`;
const password = randomBytes(32).toString('base64url');
let started = false;
try {
  await exec('docker',[`--host=${host}`,'run','--rm','-d','--name',name,'-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD','-e','POSTGRES_DB=pengzhuang_test','-e','POSTGRES_USER=pgtest',config.image],{env:{...env,POSTGRES_PASSWORD:password},maxBuffer:1048576});
  started = true;
  const mapped = (await docker('port',name,'5432/tcp')).stdout.trim();
  const port = mapped.match(/127\.0\.0\.1:(\d+)/)?.[1];
  if (!port) throw new Error('Test database port unavailable');
  const url = `postgresql://pgtest:${password}@127.0.0.1:${port}/pengzhuang_test`;
  let ready = false;
  for (let i=0;i<100;i++) {
    const pool = new Pool({connectionString:url,connectionTimeoutMillis:500});
    try { await pool.query('SELECT 1'); ready=true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve,100)); }
    finally { await pool.end(); }
  }
  if (!ready) throw new Error('Test PostgreSQL readiness failed');
  const temporary = path.resolve('work/pg-tests'); mkdirSync(temporary,{recursive:true});
  const code = await new Promise((resolve,reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm',['exec','--','vitest','run','--project','integration'],{stdio:'inherit',env:{...process.env,APP_ENV:'test',TEST_DATABASE_URL:url,PG_TEST_TMP_DIR:temporary}});
    child.once('error',reject); child.once('exit',(value)=>resolve(value ?? 1));
  });
  process.exitCode = code;
} catch {
  // exec errors can include command environment; do not print the raw child error.
  console.error('Isolated PostgreSQL test failed; check local Docker availability and integration output');
  process.exitCode = 1;
} finally { if (started) await docker('rm','-f',name); }

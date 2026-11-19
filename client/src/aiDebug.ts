import { createDecisionBroker } from '@pengzhuang/platform';
import { AI_POLICY, createWebAiWorker, adaptWebAiWorker } from './aiService';
import { DEFAULT_DATA } from '../../shared/data';
import { createMatch, beginTurn, validateShot } from '../../shared/match';
import { AiReplySchema } from '../../packages/contracts/src/ai';
if (!import.meta.env.DEV) throw new Error('AI audit is development only');
let clicks = 0;
document.querySelector('#probe')!.addEventListener('click', () => {
  clicks++;
});
let frames = 0,
  raf = 0;
const heartbeat = () => {
  frames++;
  raf = requestAnimationFrame(heartbeat);
};
raf = requestAnimationFrame(heartbeat);
async function audit() {
  let created = 0,
    terminated = 0;
  const slowUrl = URL.createObjectURL(
    new Blob(['self.onmessage = () => { while (true) {} };'], { type: 'text/javascript' }),
  );
  const wrap = (factory: typeof createWebAiWorker) => () => {
    const worker = factory();
    created++;
    return {
      ...worker,
      terminate() {
        terminated++;
        worker.terminate();
      },
    };
  };
  const blocked = createDecisionBroker(wrap(() => adaptWebAiWorker(new Worker(slowUrl))));
  const real = createDecisionBroker(wrap(createWebAiWorker));
  try {
    const before = frames,
      start = performance.now();
    const blockedResult = blocked.run({ test: 'infinite-compute' }, AI_POLICY.workerDeadlineMs);
    setTimeout(() => {
      (document.querySelector('#probe') as HTMLButtonElement).click();
    }, 30);
    const timeout = await blockedResult,
      elapsedMs = performance.now() - start,
      framesDuringBlocked = frames - before;
    if (timeout.status !== 'timeout' || framesDuringBlocked < 1 || clicks !== 1)
      throw new Error('Blocked worker affected main-thread responsiveness');
    const pending = blocked.run({ test: 'cancel' }, 1000);
    setTimeout(() => blocked.cancel(), 30);
    const cancelled = await pending;
    if (cancelled.status !== 'aborted') throw new Error('Worker cancellation failed');
    const state = createMatch(DEFAULT_DATA, [DEFAULT_DATA.rules.defaultLineup, DEFAULT_DATA.rules.defaultLineup], {
      seed: 101,
      firstSide: 0,
    });
    beginTurn(state, DEFAULT_DATA);
    const epoch = { shotNo: state.shotNo, turn: state.turn, dataVersion: state.dataVersion },
      unchanged = JSON.stringify(state),
      started = performance.now();
    const result = await real.run({ state, epoch, level: 'normal', seed: 13 }, AI_POLICY.workerDeadlineMs);
    if (result.status !== 'completed') throw new Error('Real AI worker did not complete within policy deadline');
    const reply = AiReplySchema.parse(result.value);
    if (
      !reply.input ||
      validateShot(state, DEFAULT_DATA, state.turn, reply.input) ||
      JSON.stringify(state) !== unchanged
    )
      throw new Error('Real AI reply was invalid or mutated authority');
    const jobMs = performance.now() - started;
    if (created !== terminated || blocked.pending || real.pending) throw new Error('Worker resources not released');
    return {
      status: 'passed',
      timeout: { ...timeout, elapsedMs, framesDuringBlocked, clicks },
      cancelled,
      realWorker: { jobMs, epoch, stats: reply.stats, input: reply.input },
      created,
      terminated,
    };
  } finally {
    blocked.dispose();
    real.dispose();
    cancelAnimationFrame(raf);
    URL.revokeObjectURL(slowUrl);
  }
}
audit()
  .then((result) => {
    (window as unknown as { __aiAudit: unknown }).__aiAudit = result;
    document.querySelector('#output')!.textContent = JSON.stringify(result, null, 2);
  })
  .catch((error) => {
    (window as unknown as { __aiAudit: unknown }).__aiAudit = { status: 'failed', message: String(error) };
    throw error;
  });

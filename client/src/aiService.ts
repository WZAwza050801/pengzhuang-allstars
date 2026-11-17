import { createDecisionBroker, type DecisionWorker } from '@pengzhuang/platform';
import { AiPolicySchema } from '../../packages/contracts/src/ai';
import policy from '../../config/ai-policy.json';
export const AI_POLICY = Object.freeze(AiPolicySchema.parse(policy));
export function createWebAiWorker(): DecisionWorker {
  return adaptWebAiWorker(new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' }));
}
export function adaptWebAiWorker(worker: Worker): DecisionWorker {
  return {
    postMessage: (value) => worker.postMessage(value),
    onMessage(callback) {
      const handler = (event: MessageEvent) => callback(event.data);
      worker.addEventListener('message', handler);
      return () => worker.removeEventListener('message', handler);
    },
    onError(callback) {
      const handler = (event: ErrorEvent) => {
        event.preventDefault();
        callback();
      };
      worker.addEventListener('error', handler);
      return () => worker.removeEventListener('error', handler);
    },
    terminate: () => worker.terminate(),
  };
}
export const createAiBroker = () => createDecisionBroker(createWebAiWorker);

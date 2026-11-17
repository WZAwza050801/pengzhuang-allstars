import { expect, test } from 'vitest';
import {
  beginViewRequest,
  cancelViewRequest,
  completeViewRequest,
  createViewRequestState,
} from '../packages/client-model/src/web-shell';

test('a late view request result cannot replace a newer request', () => {
  const first = beginViewRequest(createViewRequestState());
  const second = beginViewRequest(first.state);

  expect(completeViewRequest(second.state, first.id, { kind: 'ready' })).toEqual(second.state);
  expect(completeViewRequest(second.state, second.id, { kind: 'ready' })).toEqual({
    generation: second.id,
    status: 'ready',
  });
});

test('the active request records a recoverable failure without a stale value', () => {
  const request = beginViewRequest(createViewRequestState());

  expect(completeViewRequest(request.state, request.id, { kind: 'error', message: '进入比赛失败' })).toEqual({
    generation: request.id,
    status: 'error',
    message: '进入比赛失败',
  });
});

test('cancelling the active request makes its later completion inert', () => {
  const request = beginViewRequest(createViewRequestState());
  const cancelled = cancelViewRequest(request.state, request.id);

  expect(cancelled).toEqual({ generation: request.id, status: 'idle' });
  expect(completeViewRequest(cancelled, request.id, { kind: 'ready' })).toEqual(cancelled);
});

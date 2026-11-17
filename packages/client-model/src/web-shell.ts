export type ViewRequestResult = { kind: 'ready' } | { kind: 'error'; message: string };

export type ViewRequestState =
  | { generation: number; status: 'idle' | 'pending' | 'ready' }
  | { generation: number; status: 'error'; message: string };

export function createViewRequestState(): ViewRequestState {
  return { generation: 0, status: 'idle' };
}

export function beginViewRequest(state: ViewRequestState): { id: number; state: ViewRequestState } {
  const id = state.generation + 1;
  return { id, state: { generation: id, status: 'pending' } };
}

export function completeViewRequest(
  state: ViewRequestState,
  id: number,
  result: ViewRequestResult,
): ViewRequestState {
  if (state.generation !== id || state.status !== 'pending') return state;
  return result.kind === 'ready'
    ? { generation: id, status: 'ready' }
    : { generation: id, status: 'error', message: result.message };
}

export function cancelViewRequest(state: ViewRequestState, id: number): ViewRequestState {
  return state.generation === id && state.status === 'pending' ? { generation: id, status: 'idle' } : state;
}

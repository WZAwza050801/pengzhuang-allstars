export interface ServerClock { nowMs(): number; wallMs(): number }
export const systemClock: ServerClock = { nowMs: () => performance.now(), wallMs: () => Date.now() };

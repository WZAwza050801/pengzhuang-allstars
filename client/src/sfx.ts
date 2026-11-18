let ac: AudioContext | null = null;
let master: GainNode | null = null;
let volume: number | null = null;
let muted: boolean | null = null;
let paused = false;
const timers = new Set<ReturnType<typeof setTimeout>>();
function schedule(run: () => void, ms: number) { const timer = setTimeout(() => { timers.delete(timer); run(); }, ms); timers.add(timer); }
export function pauseAudio() { paused = true; for (const timer of timers) clearTimeout(timer); timers.clear(); if (ac?.state === 'running') void ac.suspend().catch(() => undefined); }
export function resumeAudio() { paused = false; }
export function disposeAudio() { pauseAudio(); const old = ac; ac = null; master = null; if (old) void old.close().catch(() => undefined); }

function ctx() {
  if (!ac) { if (typeof AudioContext === 'undefined') return null; ac = new AudioContext(); master = ac.createGain(); master.gain.value = isMuted() ? 0 : getVolume(); master.connect(ac.destination); }
  if (ac.state === 'suspended') void ac.resume().catch(() => undefined);
  return ac;
}

export function setMuted(m: boolean) {
  muted = m;
  if (ac && master) master.gain.setValueAtTime(m ? 0 : getVolume(), ac.currentTime);
  try { localStorage.setItem('pz_muted', m ? '1' : '0'); } catch { /* Local preference still works if storage is blocked. */ }
}
export function isMuted(): boolean { if (muted === null) { try { muted = localStorage.getItem('pz_muted') === '1'; } catch { muted = false; } } return muted; }
export function getVolume(): number {
  if (volume === null) { try { const raw = localStorage.getItem('pz_volume'); const saved = raw === null ? 0.8 : Number(raw); volume = Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.8; } catch { volume = 0.8; } }
  return volume;
}
export function setVolume(value: number) {
  if (!Number.isFinite(value)) return;
  volume = Math.max(0, Math.min(1, value));
  if (ac && master) master.gain.setValueAtTime(isMuted() ? 0 : volume, ac.currentTime);
  try { localStorage.setItem('pz_volume', String(volume)); } catch { /* The current audio preference still applies. */ }
}

function tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slide = 0) {
  if (isMuted() || paused) return;
  const a = ctx();
  if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(master!);
  o.start();
  o.stop(a.currentTime + dur);
}

export const sfx = {
  unlock: () => { if (!isMuted() && !paused) ctx(); },
  hit: (speed: number) => tone(300 + Math.min(speed, 8) * 40, 0.08, Math.min(0.35, 0.05 + speed * 0.04), 'triangle', -120),
  kick: (speed: number) => tone(520, 0.09, Math.min(0.4, 0.08 + speed * 0.03), 'square', -260),
  wall: (speed: number) => tone(140, 0.12, Math.min(0.3, 0.04 + speed * 0.03), 'sine', -40),
  spring: () => { tone(180, 0.22, 0.28, 'triangle', 520); schedule(() => tone(420, 0.18, 0.12, 'sine', -200), 60); },
  post: () => { tone(880, 0.25, 0.25, 'triangle'); tone(1320, 0.2, 0.12, 'sine'); },
  shoot: (power: number) => tone(200 + power * 200, 0.12, 0.2, 'sawtooth', 300),
  goal: () => [523, 659, 784, 1047].forEach((f, i) => schedule(() => tone(f, 0.35, 0.22, 'triangle'), i * 110)),
  skill: () => { tone(660, 0.15, 0.18, 'sine', 400); schedule(() => tone(990, 0.2, 0.15, 'sine', 300), 90); },
  turn: () => tone(740, 0.12, 0.12, 'sine'),
};

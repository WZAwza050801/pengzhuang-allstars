/** Read-only interpolation of server-recorded millimetres; never modifies frames or authoritative state. */
export function samplePlayback(frames: readonly (readonly number[])[], recordHz: number, seconds: number) {
  if (!frames.length || !Number.isFinite(recordHz) || recordHz <= 0 || !Number.isFinite(seconds))
    throw new Error('Invalid playback');
  const last = frames.length - 1,
    fi = Math.max(0, seconds) * recordHz;
  const i0 = Math.min(last, Math.floor(fi)),
    i1 = Math.min(last, i0 + 1),
    k = Math.min(1, fi - i0);
  const a = frames[i0],
    b = frames[i1];
  if (a.length !== b.length || a.length % 2) throw new Error('Invalid playback frame');
  const positions = [];
  for (let j = 0; j < a.length; j += 2)
    positions.push({ x: (a[j] + (b[j] - a[j]) * k) / 1000, y: (a[j + 1] + (b[j + 1] - a[j + 1]) * k) / 1000 });
  return { positions, complete: fi >= last };
}

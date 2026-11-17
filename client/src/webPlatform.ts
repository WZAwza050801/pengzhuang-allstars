import { createWebPlatform, PlatformError } from '@pengzhuang/platform';
import { sfx, pauseAudio, resumeAudio, disposeAudio } from './sfx';

export function createGamePlatform() {
  resumeAudio();
  const effects: Record<string, (value: number) => unknown> = {
    hit: sfx.hit, kick: sfx.kick, wall: sfx.wall, spring: sfx.spring, post: sfx.post,
    shoot: sfx.shoot, goal: sfx.goal, skill: sfx.skill, turn: sfx.turn,
  };
  return createWebPlatform({ audio: {
    async unlock() { sfx.unlock(); },
    play(id, value = 0.5) { const effect = effects[id]; if (!effect) throw new PlatformError('unknown-audio'); effect(value); },
    pause: pauseAudio, resume: resumeAudio, dispose: disposeAudio,
  } });
}

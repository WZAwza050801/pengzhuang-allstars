/** Existing implemented semantics. New source-only skill names are not mapped by resemblance. */
export const SKILL_TIMING_VERSION = 'skill-timing-1';
export const SKILL_EFFECT_POLICIES = Object.freeze({
  shooterBuff: Object.freeze({
    trigger: 'preturn',
    duration: 'current-action',
    stack: 'multiply-selected-shooter-only',
  }),
  extraAction: Object.freeze({
    trigger: 'preturn',
    duration: 'owner-turn',
    stack: 'one-extra-action-until-owner-turn-ends',
  }),
  ballBoost: Object.freeze({ trigger: 'onShot', duration: 'current-shot', stack: 'first-eligible-ball-contact-only' }),
  sendOffOnHit: Object.freeze({
    trigger: 'onShot',
    duration: 'owner-turn-end',
    stack: 'set-duration-on-unique-opponents-hit',
  }),
  freezeOnHit: Object.freeze({ trigger: 'onShot', duration: 'owner-turn-end', stack: 'maximum-remaining-duration' }),
  anchor: Object.freeze({ trigger: 'defense', duration: 'current-action', stack: 'static-if-frozen-or-anchored' }),
  halfMassAura: Object.freeze({
    trigger: 'passive',
    duration: 'while-on-pitch-in-own-half',
    stack: 'strongest-aura-per-side; multiply-shooter-buff',
  }),
});

import rawFieldsJson from '../data/fields.json';
import { FieldDefinitionsSchema } from '../packages/contracts/src/field';
import type { FieldGeometry } from '../packages/game-core/src/field';
export type { FieldGeometry } from '../packages/game-core/src/field';
const fieldsJson = FieldDefinitionsSchema.parse(rawFieldsJson);
import { freezeSnapshot } from '../packages/game-core/src/snapshot';
import rawPhysics from '../data/physics.json';
import { PhysicsConfigSchema } from '../packages/contracts/src/physics';
import { GameDefinitionsSchema } from '../packages/contracts/src/game-definitions';
import rawPlayers from '../data/players.json';
import rawSkills from '../data/skills.json';
import rawRules from '../data/rules.json';
import rawMapping from '../data/attr-mapping.json';
// Named imports so the bundler can drop `others` (1.2.0 and variant-card rows), which the runtime never reads.
import { version as levelsVersion, players as rawLevels } from '../data/levels.json';

const definitions = GameDefinitionsSchema.parse({ geometry: fieldsJson.geometry, physics: rawPhysics, players: rawPlayers, skills: rawSkills, rules: rawRules, mapping: rawMapping, levels: { version: levelsVersion, players: rawLevels } });
const physicsJson = definitions.physics, playersJson = definitions.players, skillsJson = definitions.skills, rulesJson = definitions.rules, attrMapJson = definitions.mapping, levelTable = definitions.levels.players;

export type PhysicsConfig = typeof physicsJson;
export type RulesConfig = typeof rulesJson;
export type PlayerDef = (typeof playersJson.players)[number];
export type AttrMapping = typeof attrMapJson;
/** Raw attribute points of one card level, named as in the source table (points, not kg / N / degrees). */
export interface LevelAttrs {
  weight: number;
  power: number;
  mind: number;
  radian: number;
  precision: number;
}

export type SkillTrigger = 'preturn' | 'onShot' | 'defense' | 'passive';
export interface SkillEffect {
  type: 'shooterBuff' | 'ballBoost' | 'sendOffOnHit' | 'freezeOnHit' | 'halfMassAura' | 'anchor' | 'extraAction';
  speedMul?: number;
  massMul?: number | number[];
  curveMul?: number;
  ballSpeedMul?: number;
  requireInBox?: boolean;
}
export interface SkillDef {
  id: string;
  name: string;
  trigger: SkillTrigger;
  probability: number[];
  durationTurns: number;
  effect: SkillEffect;
  effectText: string;
  unlockLevel: number;
}

/** Everything a match needs, frozen together so one match never mixes versions. */
export interface GameData {
  version: string;
  geometry: FieldGeometry;
  physics: PhysicsConfig;
  rules: RulesConfig;
  players: Record<string, PlayerDef>;
  skills: Record<string, SkillDef>;
  /** Source player_id -> level -> points (1.5.5 base cards, data/levels.json). Players with srcId null are not in it. */
  levels: Record<string, Record<string, LevelAttrs>>;
  mapping: AttrMapping;
}

export function buildGameData(physics: PhysicsConfig = physicsJson): GameData {
  physics = PhysicsConfigSchema.parse(physics);
  const players: Record<string, PlayerDef> = {};
  for (const p of playersJson.players) players[p.id] = p;
  const skills: Record<string, SkillDef> = {};
  for (const s of skillsJson.skills) skills[s.id] = s as SkillDef;
  return {
    version: [fieldsJson.version, physics.version, playersJson.version, skillsJson.version, rulesJson.version, levelsVersion, attrMapJson.version].join('/'),
    geometry: fieldsJson.geometry,
    physics,
    rules: rulesJson,
    players,
    skills,
    levels: levelTable,
    mapping: attrMapJson,
  };
}

export const DEFAULT_DATA = freezeSnapshot(buildGameData());
export const FIELD_SKINS = fieldsJson.skins;
export const PLAYER_LIST = playersJson.players;

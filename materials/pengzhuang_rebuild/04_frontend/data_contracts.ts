/** 设计草案，非已实现SDK。数字单位采用复刻世界长度单位u与秒；原属性单独存。 */
export type SourceVersion = "1.2.0" | "1.5.5";
export type TeamId = "red" | "blue";
export type MatchPhase = "waiting" | "aiming" | "moving" | "goal" | "reconnecting" | "finished";
export interface RawAttributes {
  readonly weight: number;
  readonly power: number;
  readonly mind: number;
  readonly radian: number;
  readonly precision: number;
}
export interface ResolvedCard {
  readonly playerId: string;
  readonly cardId: string;
  readonly sourceVersion: SourceVersion;
  readonly sourceTable: "card" | "card_attr";
  readonly sourceLevel: number | null;
  readonly selectionReason: string;
  readonly original: RawAttributes;
  readonly portraitId: string;
  readonly skillIds: readonly string[];
}
export interface ShotRequest {
  readonly matchId: string;
  readonly turnId: number;
  readonly clientShotId: string;
  readonly playerId: string;
  readonly directionX: number;
  readonly directionY: number;
  readonly power01: number;
  readonly curveMinus1To1: number;
  readonly configVersion: string;
}
export interface BodySnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly angularVelocity: number;
}
export interface MatchSnapshot {
  readonly matchId: string;
  readonly simulationTick: number;
  readonly turnId: number;
  readonly phase: MatchPhase;
  readonly activeTeamId: TeamId;
  readonly redScore: number;
  readonly blueScore: number;
  readonly turnDeadlineServerMs: number | null;
  readonly discs: readonly BodySnapshot[];
  readonly ball: BodySnapshot;
  readonly acceptedShotId: string | null;
  readonly rulesVersion: string;
  readonly physicsVersion: string;
  readonly rosterVersion: string;
}
export type ShotResult =
  | { readonly type: "accepted"; readonly clientShotId: string; readonly acceptedTick: number }
  | { readonly type: "rejected"; readonly clientShotId: string; readonly reason: "wrong_turn" | "moving" | "invalid_input" | "stale_config" | "wrong_player" };
export interface PhysicsTuning {
  readonly schemaVersion: 1;
  readonly fixedStepSeconds: number;
  readonly discRadiusU: number;
  readonly ballRadiusU: number;
  readonly maxLaunchSpeedUPerSecond: number;
  readonly dragDecelerationUPerSecondSquared: number;
  readonly discRestitution: number;
  readonly wallRestitution: number;
  readonly settleSpeedUPerSecond: number;
  readonly settleDurationSeconds: number;
  readonly maxMovingSeconds: number;
}

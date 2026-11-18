import type { SqlExecutor } from './database';
import type { OutcomeIntent } from '../../contracts/src/match-results';
import type { EconomyPolicy } from '../../contracts/src/economy';
import type { ModeRules } from '../../contracts/src/modes';
import type { GameData } from '../../../shared/data';

export interface SettlementConfiguration {
  hash: string;
  data: GameData;
  policy: EconomyPolicy;
  rules: ModeRules;
}
export interface StoredOutcome {
  matchId: string;
  payloadHash: string;
  payload: OutcomeIntent;
  settledAt: Date | null;
  createdAt: Date;
}
export interface SettlementEvent {
  id: string;
  matchId: string;
  payload: { payloadHash: string };
  attempts: number;
}
export class MatchOutcomeRepository {
  constructor(private readonly sql: SqlExecutor) {}
  async pin(matchId: string, config: SettlementConfiguration): Promise<boolean> {
    await this.sql.query(
      `INSERT INTO match_settlement_configurations(hash,game_version,economy_version,modes_version,mode,game_data,economy_policy,mode_rules)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [
        config.hash,
        config.data.version,
        config.policy.version,
        config.rules.modesVersion,
        config.rules.mode,
        JSON.stringify(config.data),
        JSON.stringify(config.policy),
        JSON.stringify(config.rules),
      ],
    );
    const pinned = (
      await this.sql.query<{ hash: string }>(
        `SELECT hash FROM match_settlement_configurations WHERE game_version=$1 AND economy_version=$2 AND modes_version=$3 AND mode=$4`,
        [config.data.version, config.policy.version, config.rules.modesVersion, config.rules.mode],
      )
    ).rows[0];
    if (pinned?.hash !== config.hash) return false;
    await this.sql.query(
      'INSERT INTO match_settlement_contexts(match_id,configuration_hash) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [matchId, config.hash],
    );
    return (
      (
        await this.sql.query<{ configuration_hash: string }>(
          'SELECT configuration_hash FROM match_settlement_contexts WHERE match_id=$1',
          [matchId],
        )
      ).rows[0]?.configuration_hash === config.hash
    );
  }
  async configuration(matchId: string): Promise<SettlementConfiguration | null> {
    return (
      (
        await this.sql.query<SettlementConfiguration>(
          `SELECT c.hash,c.game_data AS data,c.economy_policy AS policy,c.mode_rules AS rules
      FROM match_settlement_configurations c JOIN match_settlement_contexts m ON m.configuration_hash=c.hash WHERE m.match_id=$1`,
          [matchId],
        )
      ).rows[0] ?? null
    );
  }
  async lockMatch(id: string) {
    return (
      (
        await this.sql.query<{ id: string; mode: string; config_version: string; protocol_version: number }>(
          'SELECT id,mode,config_version,protocol_version FROM matches WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0] ?? null
    );
  }
  async participants(id: string) {
    return (
      await this.sql.query<{ userId: string; side: 0 | 1 }>(
        'SELECT user_id AS "userId",side FROM match_participants WHERE match_id=$1 ORDER BY side',
        [id],
      )
    ).rows;
  }
  async outcome(id: string, lock = false): Promise<StoredOutcome | null> {
    return (
      (
        await this.sql.query<StoredOutcome>(
          `SELECT match_id AS "matchId",payload_hash AS "payloadHash",payload,settled_at AS "settledAt",created_at AS "createdAt" FROM match_outcomes WHERE match_id=$1${lock ? ' FOR UPDATE' : ''}`,
          [id],
        )
      ).rows[0] ?? null
    );
  }
  async record(outcome: OutcomeIntent, hash: string) {
    await this.sql.query('INSERT INTO match_outcomes(match_id,payload_hash,payload,final_seq) VALUES ($1,$2,$3,$4)', [
      outcome.matchId,
      hash,
      JSON.stringify(outcome),
      outcome.finalSeq,
    ]);
    await this.sql.query("UPDATE matches SET status='settlement-pending',result=$2,completed_at=$3 WHERE id=$1", [
      outcome.matchId,
      JSON.stringify(outcome),
      outcome.endedAt,
    ]);
    await this.sql.query(
      "INSERT INTO outbox_events(type,aggregate_id,payload) VALUES ('match.settle',$1,$2) ON CONFLICT (type,aggregate_id) WHERE type='match.settle' DO NOTHING",
      [outcome.matchId, JSON.stringify({ payloadHash: hash })],
    );
  }
  async nextEvent(matchId?: string): Promise<SettlementEvent | null> {
    return (
      (
        await this.sql.query<SettlementEvent>(
          `SELECT id,aggregate_id AS "matchId",payload,attempts FROM outbox_events
      WHERE type='match.settle' AND processed_at IS NULL AND attempts<12 AND next_attempt_at<=clock_timestamp()
      AND ($1::text IS NULL OR aggregate_id=$1) ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [matchId ?? null],
        )
      ).rows[0] ?? null
    );
  }
  async failEvent(eventId: string, code: string) {
    const result = await this.sql.query<{ attempts: number }>(
      `UPDATE outbox_events SET attempts=CASE WHEN $2='outcome-conflict' THEN 12 ELSE attempts+1 END,error_code=$2,
      next_attempt_at=clock_timestamp()+LEAST(300,POWER(2,LEAST(attempts,9))) * interval '1 second'
      WHERE id=$1 AND processed_at IS NULL AND attempts<12 RETURNING attempts`,
      [eventId, code],
    );
    return result.rows[0]?.attempts;
  }
  async settled(outcome: OutcomeIntent, eventId: string, isVoid: boolean) {
    await this.sql.query(
      'UPDATE match_outcomes SET settled_at=clock_timestamp() WHERE match_id=$1 AND settled_at IS NULL',
      [outcome.matchId],
    );
    const closed = outcome.reason === 'disconnect' || outcome.reason === 'abandoned' ? 'expired' : 'ended';
    await this.sql.query(
      `UPDATE matches SET status=$2,recovery_closed_at=COALESCE(recovery_closed_at,clock_timestamp()),recovery_close_reason=COALESCE(recovery_close_reason,$3) WHERE id=$1`,
      [outcome.matchId, isVoid ? 'void' : 'settled', closed],
    );
    await this.sql.query('UPDATE outbox_events SET processed_at=clock_timestamp(),error_code=NULL WHERE id=$1', [
      eventId,
    ]);
  }
  async rewardDay(userId: string, day: string) {
    await this.sql.query('INSERT INTO match_reward_days(user_id,day_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
      userId,
      day,
    ]);
    return (
      await this.sql.query<{ coins: string; cardClaimed: boolean; qualifiedMatches: number }>(
        'SELECT earned_coins::text AS coins,card_claimed AS "cardClaimed",qualified_matches AS "qualifiedMatches" FROM match_reward_days WHERE user_id=$1 AND day_key=$2 FOR UPDATE',
        [userId, day],
      )
    ).rows[0];
  }
  async progress(userId: string, version: string) {
    await this.sql.query(
      'INSERT INTO match_participation_progress(user_id,economy_version) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [userId, version],
    );
    return (
      await this.sql.query<{ progress: number; claimIndex: string }>(
        'SELECT progress,claim_index::text AS "claimIndex" FROM match_participation_progress WHERE user_id=$1 AND economy_version=$2 FOR UPDATE',
        [userId, version],
      )
    ).rows[0];
  }
  async advanceProgress(userId: string, version: string, progress: number, claimed: boolean) {
    await this.sql.query(
      'UPDATE match_participation_progress SET progress=$3,claim_index=claim_index+$4 WHERE user_id=$1 AND economy_version=$2',
      [userId, version, progress, claimed ? 1 : 0],
    );
  }
  async recordReward(value: {
    matchId: string;
    userId: string;
    eligible: boolean;
    coins: string;
    fragments: string;
    playerDefId: string | null;
    operationId: string | null;
    ledgerIds: string[];
    day: string;
  }) {
    await this.sql.query(
      `INSERT INTO match_rewards(match_id,user_id,reward_type,eligible,coins,fragments,player_def_id,operation_id,ledger_ids,day_key)
      VALUES ($1,$2,'completion',$3,$4,$5,$6,$7,$8,$9)`,
      [
        value.matchId,
        value.userId,
        value.eligible,
        value.coins,
        value.fragments,
        value.playerDefId,
        value.operationId,
        value.ledgerIds,
        value.day,
      ],
    );
    await this.sql.query(
      `UPDATE match_reward_days SET earned_coins=earned_coins+$3,card_claimed=card_claimed OR $4,qualified_matches=qualified_matches+$5 WHERE user_id=$1 AND day_key=$2`,
      [value.userId, value.day, value.coins, value.playerDefId !== null, value.eligible ? 1 : 0],
    );
  }
}

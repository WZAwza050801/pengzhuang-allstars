import { useEffect, useState } from 'react';
import type { LocalImportReceipt } from '../../../packages/contracts/src/local-import';
import { canSaveOwnedLineup, type OwnedCardView } from '../../../packages/client-model/src/owned-lineup';
import { useAccount } from '../accounts/context';
import styles from './inventory.module.css';
export function ImportedLineups({
  userId,
  cards,
  disabled,
  onApply,
}: {
  userId: string;
  cards: readonly OwnedCardView[];
  disabled: boolean;
  onApply(ids: string[]): void;
}) {
  const { services } = useAccount();
  const [receipt, setReceipt] = useState<LocalImportReceipt | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void services!.api.localImportStatus(userId).then((result) => {
      if (!active) return;
      setFailed(!result.ok);
      if (result.ok) setReceipt(result.data.receipt);
    });
    return () => {
      active = false;
    };
  }, [services, userId, attempt]);
  if (failed)
    return (
      <p>
        旧阵容偏好暂未读取。
        <button className="pz-button" onClick={() => setAttempt((value) => value + 1)}>
          重读旧偏好
        </button>
      </p>
    );
  if (!receipt?.lineups.length) return null;
  return (
    <div>
      <p>已导入的旧阵容偏好（仅填入草稿，保存后生效）：</p>
      <div className={styles.actions}>
        {receipt.lineups.map((lineup) => (
          <button
            className="pz-button"
            key={lineup.slot}
            disabled={disabled || !canSaveOwnedLineup(lineup.ownedCardIds, cards)}
            onClick={() => onApply([...lineup.ownedCardIds])}
          >
            采用旧偏好 {lineup.slot + 1}
          </button>
        ))}
      </div>
      <p className={styles.muted}>含已停用或不再持有卡的偏好不可采用。</p>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { inspectLegacyStorage } from '../../../packages/client-model/src/local-import';
import type { LocalImportReceipt } from '../../../packages/contracts/src/local-import';
import { FIELD_SKINS } from '../../../shared/data';
import { useAccount } from './context';
import { accountError } from './forms';
import { setMuted } from '../sfx';
import styles from './pages.module.css';

export function LocalImportPanel() {
  const { services, login } = useAccount();
  const [preview, setPreview] = useState<ReturnType<typeof inspectLegacyStorage> | null>(null);
  const [receipt, setReceipt] = useState<LocalImportReceipt | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const lifetime = useRef({ active: true });
  useEffect(() => {
    lifetime.current.active = true;
    return () => {
      lifetime.current.active = false;
    };
  }, [lifetime]);
  const userId = login.user!.userId;
  const check = async () => {
    setBusy(true);
    setNotice('');
    const result = await services!.api.localImportStatus(userId);
    if (!lifetime.current.active) return;
    setBusy(false);
    if (!result.ok) {
      setNotice(accountError(result.error.code));
      if (result.error.code === 'UNAUTHENTICATED') void services!.changed(false);
      return;
    }
    setChecked(true);
    setReceipt(result.data.receipt);
    if (!result.data.receipt) {
      try {
        setPreview(inspectLegacyStorage(window.localStorage));
      } catch {
        setNotice('浏览器不允许读取本地存档。请开启存储权限后重试。');
      }
    }
  };
  const commit = async () => {
    if (!preview?.command || busy) return;
    setBusy(true);
    setNotice('');
    const result = await services!.api.importLocalPreferences(preview.command, userId);
    if (!lifetime.current.active) return;
    setBusy(false);
    if (result.ok) {
      setReceipt(result.data);
      setPreview(null);
      setNotice('偏好已保存到当前账号。原练习存档已保留。');
    } else {
      setNotice(
        result.error.code === 'CONFLICT'
          ? '账号或导入状态已变化，请重新检查。'
          : `${accountError(result.error.code)} 可保留本次预览重试。`,
      );
      if (result.error.code === 'UNAUTHENTICATED') void services!.changed(false);
    }
  };
  const saved = receipt ?? preview?.command;
  return (
    <section className={styles.section} aria-labelledby="local-import-title" aria-busy={busy}>
      <h2 id="local-import-title">旧本地存档</h2>
      <p>
        可导入声音、球场、昵称草稿与持有卡阵容偏好。金币、等级和卡牌资产由服务器生成。每个账号导入一次，昵称和正式阵容需另行确认。
      </p>
      <button className="pz-button" disabled={busy} onClick={() => void check()}>
        {busy ? '正在处理…' : '检查旧本地存档'}
      </button>
      {receipt && <p>当前账号已完成导入。</p>}
      {saved && (
        <div>
          <p>昵称草稿：{saved.nicknameDraft ?? '无'}</p>
          <p>
            声音：{saved.settings.muted === undefined ? '未设置' : saved.settings.muted ? '静音' : '开启'}；球场：
            {saved.settings.skinId
              ? (FIELD_SKINS.find((skin) => skin.id === saved.settings.skinId)?.name ?? saved.settings.skinId)
              : '未设置'}
          </p>
          <p>
            {receipt
              ? `已保存 ${receipt.lineups.length} 套持有卡阵容偏好；${receipt.skippedLineups.length} 套因未持有或不可用跳过。`
              : `检测到 ${preview!.command!.lineups.length} 套阵容，保存时仅保留当前账号持有且可用的卡。`}
          </p>
        </div>
      )}
      {preview?.warnings.map((warning, index) => (
        <p key={index}>{warning}</p>
      ))}
      {checked && preview && !preview.command && <p>没有可导入的合法偏好。旧练习存档不受影响。</p>}
      {preview?.command && !receipt && (
        <button className="pz-button" disabled={busy} onClick={() => void commit()}>
          确认导入到当前账号
        </button>
      )}
      {receipt && Object.keys(receipt.settings).length > 0 && (
        <button
          className="pz-button"
          disabled={busy}
          onClick={() => {
            try {
              if (receipt.settings.skinId) localStorage.setItem('pz_skin', receipt.settings.skinId);
              if (receipt.settings.muted !== undefined) {
                localStorage.setItem('pz_muted', receipt.settings.muted ? '1' : '0');
                setMuted(receipt.settings.muted);
              }
              setNotice('已应用声音和球场设置，下一场练习生效。');
            } catch {
              setNotice('本机设置未完整保存，请检查浏览器存储权限后重试。');
            }
          }}
        >
          在本机使用导入设置
        </button>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}

import { useState } from 'react';
import { Link } from 'react-router';
import {
  readVisualPreferences,
  saveVisualPreferences,
  TEXT_SCALES,
  type VisualPreferences,
} from './ui/visual-preferences';
import styles from './accounts/pages.module.css';

export function SettingsPage() {
  const [value, setValue] = useState(readVisualPreferences),
    [notice, setNotice] = useState('');
  const change = (next: VisualPreferences) => {
    setValue(next);
    const saved = saveVisualPreferences(next);
    setNotice(saved ? '显示设置已保存到本机。' : '本次设置已生效，但浏览器未允许保存。重新打开后可能恢复默认。');
  };
  return (
    <section className={styles.page}>
      <p className={styles.eyebrow}>本机偏好</p>
      <h1>显示与操作设置</h1>
      <label>
        文字大小
        <select
          name="text-scale"
          aria-label="文字大小"
          value={value.textScale}
          onChange={(event) => change({ ...value, textScale: Number(event.target.value) })}
        >
          {TEXT_SCALES.map((scale) => (
            <option value={scale} key={scale}>
              {scale * 100}%{scale === 1 ? '（默认）' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          name="reduce-motion"
          type="checkbox"
          checked={value.reducedMotion}
          onChange={(event) => change({ ...value, reducedMotion: event.target.checked })}
        />
        始终减少动画
      </label>
      <p>系统要求减少动画时也会自动生效。减少的是画面运动，比赛计时和出手规则保持一致。</p>
      <p>场地外观、音量和画质在比赛菜单调整；键盘与辅助出手也在菜单中。</p>
      <p role="status">{notice}</p>
      <Link className="pz-button" to="/help" state={{ from: '/settings' }}>
        问题与反馈
      </Link>
      <Link className="pz-button" to="/">
        返回大厅
      </Link>
    </section>
  );
}

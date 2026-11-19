import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { feedbackText } from './ui/support-info';
import { usePublicLobby } from './lobby-context';
import styles from './accounts/pages.module.css';

export function SupportPage() {
  const location = useLocation(),
    { service } = usePublicLobby();
  const [note, setNote] = useState(''),
    [draft, setDraft] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const copying = useRef(false),
    output = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    if (copying.current) return;
    copying.current = true;
    setBusy(true);
    const from = typeof location.state?.from === 'string' ? location.state.from : location.pathname;
    const value = feedbackText({
      pathname: from,
      online: navigator.onLine,
      service,
      note,
      at: new Date().toISOString(),
    });
    setDraft(value);
    try {
      await navigator.clipboard.writeText(value);
      setStatus('说明已复制，尚未发送。请自行发送给提供测试版本的人员。');
    } catch {
      setStatus('自动复制不可用。请选中下方说明，手动复制；说明尚未发送。');
      requestAnimationFrame(() => {
        output.current?.focus();
        output.current?.select();
      });
    } finally {
      copying.current = false;
      setBusy(false);
    }
  };
  return (
    <section className={styles.page}>
      <p className={styles.eyebrow}>帮助与反馈</p>
      <h1>问题与反馈</h1>
      <p>说明你做了什么、看到了什么，以及期望的结果。这里仅生成说明，不会上传或自动提交。</p>
      <p>
        不填写密码、验证码、邮箱链接或登录凭据。自动信息只含页面类别、网络、服务状态和时间，不读取账号、完整网址或本地存储。
      </p>
      <label>
        复现步骤与期望
        <textarea
          name="feedback-note"
          aria-label="复现步骤与期望"
          rows={5}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <button className="pz-button pz-primary" disabled={busy} onClick={() => void copy()}>
        {busy ? '正在复制…' : '复制问题说明'}
      </button>
      <p role="status">{status}</p>
      {draft && (
        <label>
          可手动复制的说明
          <textarea ref={output} name="feedback-draft" aria-label="可手动复制的说明" readOnly rows={10} value={draft} />
        </label>
      )}
      <p>复制后，请发送给提供测试版本的人员；不要把账号凭据放进截图。</p>
      <Link className="pz-button" to="/">
        返回大厅
      </Link>
    </section>
  );
}

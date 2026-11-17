import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AccountResponse } from '../../../packages/client-model/src/account';
import styles from './pages.module.css';
import { useAccount } from './context';

const messages: Record<string, string> = {
  INVALID_REQUEST: '请检查填写内容；邮件链接可能已失效，请重新申请。',
  UNAUTHENTICATED: '登录信息不正确或已失效，请重新登录。',
  FORBIDDEN: '暂时无法完成，请重新验证当前账号后再试。',
  CONFLICT: '当前操作有冲突。身份可能已绑定其他账号，不会自动合并。',
  RATE_LIMITED: '操作太频繁，请稍后再试。',
  UNAVAILABLE: '账号服务暂不可用，请稍后再试。',
  NETWORK_ERROR: '网络未能确认操作结果，请检查连接后重试。',
};
export const accountError = (code: string) => messages[code] ?? '操作未完成，请稍后重试。';

/** A synchronous lock prevents double submissions; unmount discards stale UI effects. */
export function useAccountAction() {
  const lock = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run<T>(
    request: () => Promise<AccountResponse<T>>,
    success: (data: T) => void | Promise<void>,
    failure?: () => void,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice('');
    try {
      const result = await request();
      if (!alive.current) return;
      if (result.ok) await success(result.data);
      else {
        setNotice(accountError(result.error.code));
        failure?.();
      }
    } catch {
      if (alive.current) setNotice('操作未完成，请检查网络后重试。');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return { busy, notice, setNotice, run };
}
export function AccountLayout({ title, children }: { title: string; children: ReactNode }) {
  const { options, unavailable } = useAccount();
  useEffect(() => {
    document.getElementById('account-page-title')?.focus();
  }, [title]);
  return (
    <section className={styles.page} aria-labelledby="account-page-title">
      <p className={styles.eyebrow}>碰撞全明星 · 账号</p>
      <h1 id="account-page-title" tabIndex={-1}>
        {title}
      </h1>
      {(unavailable || (options && !options.emailEnabled)) && (
        <p role="status">邮箱账号服务暂不可用，本地练习仍然可用。</p>
      )}
      {children}
    </section>
  );
}
export function Form({
  action,
  children,
  submit,
  onSubmit,
  disabled = false,
}: {
  action: ReturnType<typeof useAccountAction>;
  children: ReactNode;
  submit: string;
  onSubmit: (form: HTMLFormElement) => void;
  disabled?: boolean;
}) {
  const handle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(event.currentTarget);
  };
  return (
    <form className={styles.form} onSubmit={handle} aria-busy={action.busy}>
      <fieldset disabled={action.busy || disabled}>
        {children}
        <button className="pz-button pz-primary" type="submit">
          {action.busy ? '正在处理…' : submit}
        </button>
      </fieldset>
      <p role="status" className={styles.notice}>
        {action.notice}
      </p>
    </form>
  );
}
export function EmailInput({ name = 'email', label = '邮箱' }: { name?: string; label?: string }) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="email"
        required
        maxLength={254}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
      />
    </label>
  );
}
export function PasswordInput({
  fresh = false,
  name = 'password',
  label = fresh ? '新密码' : '密码',
}: {
  fresh?: boolean;
  name?: string;
  label?: string;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>
        {label}
        <input
          id={id}
          name={name}
          type="password"
          required
          minLength={fresh ? 12 : 1}
          maxLength={256}
          autoComplete={fresh ? 'new-password' : 'current-password'}
          aria-describedby={fresh ? `${id}-hint` : undefined}
        />
      </label>
      {fresh && (
        <span id={`${id}-hint`} className={styles.hint}>
          至少 12 个字符，支持中文和符号。
        </span>
      )}
    </>
  );
}
export function readForm(form: HTMLFormElement | null) {
  const data = new FormData(form!);
  return {
    email: String(data.get('email') ?? ''),
    password: String(data.get('password') ?? ''),
    nickname: String(data.get('nickname') ?? ''),
  };
}

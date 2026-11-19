import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { NavigationTargetSchema, resolveNavigation, toWebPath, type NavigationContext } from '@pengzhuang/client-model';
import { useAccount } from './context';
import { AccountLayout, Form, EmailInput, PasswordInput, readForm, useAccountAction } from './forms';
import { readAccountLink, clearAccountLink } from './link-token';
import styles from './pages.module.css';

export function LoginPage({ context }: { context: NavigationContext }) {
  const { services, options, unavailable, login } = useAccount();
  const action = useAccountAction();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (login.status !== 'authenticated') return;
    const resume = NavigationTargetSchema.safeParse(location.state?.resume);
    if (!resume.success) return;
    if (readAccountLink()?.kind === 'link' && readAccountLink()?.token) {
      navigate('/account/link', { replace: true });
      return;
    }
    const decision = resolveNavigation(resume.data, { ...context, session: 'authenticated' });
    if (decision.kind === 'show') navigate(toWebPath(decision.target), { replace: true });
  }, [login.status, context, location.state, navigate]);
  return (
    <AccountLayout title="登录账号">
      <p>登录后管理账号与设备。本地练习无需登录。</p>
      {(!options?.emailEnabled || unavailable) && (
        <p role="status">
          账号服务暂不可用，仍可返回比赛页练习。
          <button className="pz-button" onClick={() => void services?.reconcile()}>
            重新连接
          </button>
        </p>
      )}
      {login.status === 'logout-pending' && <p role="status">上次退出尚未确认，请先在“我的”中重试退出。</p>}
      <Form
        action={action}
        disabled={
          !services || !options?.emailEnabled || login.status === 'logout-pending' || login.status === 'signing-out'
        }
        submit="登录"
        onSubmit={(form) => {
          const { email, password } = readForm(form);
          void action.run(
            () => services!.api.login({ email, password }),
            async () => {
              (form.elements.namedItem('password') as HTMLInputElement).value = '';
              await services!.changed(true);
              if (services!.model.snapshot.status !== 'authenticated') {
                action.setNotice('登录已提交，但会话尚未恢复，请到“我的”重新连接。');
                return;
              }
              if (readAccountLink()?.kind === 'link' && readAccountLink()?.token) {
                navigate('/account/link', { replace: true });
                return;
              }
              const resume = NavigationTargetSchema.safeParse(location.state?.resume);
              const decision = resume.success
                ? resolveNavigation(resume.data, { ...context, session: 'authenticated' })
                : null;
              navigate(decision?.kind === 'show' ? toWebPath(decision.target) : '/profile', { replace: true });
            },
          );
        }}
      >
        <EmailInput />
        <PasswordInput />
      </Form>
      <div className={styles.links}>
        <Link to="/account/register">注册账号</Link>
        <Link to="/account/forgot">找回密码</Link>
        <Link to="/account/resend">重发验证邮件</Link>
        <Link to="/account/deletion">查询或取消注销</Link>
        <Link to="/match?mode=practice">先练习</Link>
      </div>
      {options?.wechatMiniProgram && <p>微信身份登录请使用微信小游戏。网页账号可在“我的”绑定邮箱。</p>}
    </AccountLayout>
  );
}

export function RegisterPage() {
  const { services, options } = useAccount();
  const action = useAccountAction();
  const [submitted, setSubmitted] = useState(false);
  const accepted = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (submitted) accepted.current?.focus();
  }, [submitted]);
  return (
    <AccountLayout title="注册账号">
      {submitted ? (
        <p ref={accepted} tabIndex={-1} role="status">
          申请已收到。如果该邮箱可以注册，你将收到验证邮件。请查收后打开链接，验证完成再登录。
        </p>
      ) : (
        <Form
          action={action}
          disabled={!services || !options?.emailEnabled}
          submit="注册并发送验证邮件"
          onSubmit={(form) => {
            const data = readForm(form);
            void action.run(
              () => services!.api.register(data),
              () => {
                form.reset();
                setSubmitted(true);
              },
            );
          }}
        >
          <EmailInput />
          <PasswordInput fresh />
          <label>
            昵称
            <input name="nickname" required minLength={1} maxLength={12} autoComplete="nickname" />
          </label>
        </Form>
      )}
      <div className={styles.links}>
        <Link to="/login">返回登录</Link>
        <Link to="/account/resend">没收到邮件</Link>
      </div>
    </AccountLayout>
  );
}

export function RequestEmailPage({ reset }: { reset: boolean }) {
  const { services, options } = useAccount();
  const action = useAccountAction();
  return (
    <AccountLayout title={reset ? '找回密码' : '重发验证邮件'}>
      <p>如果邮箱符合条件，我们会发送邮件。请检查收件箱与垃圾邮件。</p>
      <Form
        action={action}
        disabled={!services || !options?.emailEnabled}
        submit="发送邮件"
        onSubmit={(form) => {
          const { email } = readForm(form);
          void action.run(
            () => (reset ? services!.api.resetRequest({ email }) : services!.api.verificationRequest({ email })),
            () => action.setNotice('申请已收到，请查收邮件；若未收到可稍后重试。'),
          );
        }}
      >
        <EmailInput />
      </Form>
      <div className={styles.links}>
        <Link to="/login">返回登录</Link>
      </div>
    </AccountLayout>
  );
}

export function EmailLinkPage({ kind }: { kind: 'verify' | 'reset' | 'link' }) {
  const { services, login } = useAccount();
  const action = useAccountAction();
  const [token, setToken] = useState(() => {
    const link = readAccountLink();
    return link?.kind === kind ? link.token : '';
  });
  const [done, setDone] = useState(false);
  const title = { verify: '验证邮箱', reset: '重设密码', link: '确认邮箱绑定' }[kind];
  const consume = () => {
    setToken('');
    clearAccountLink();
    setDone(true);
  };
  return (
    <AccountLayout title={title}>
      {done ? (
        <p role="status">
          操作已完成。
          {kind === 'reset'
            ? '其他设备已退出，请使用新密码重新登录。'
            : kind === 'verify'
              ? '邮箱已验证，可以登录。'
              : '邮箱已绑定。'}
        </p>
      ) : !token ? (
        <p role="status">邮件链接无效或已离开此页，请重新打开邮件或重新申请。</p>
      ) : kind === 'link' && login.status !== 'authenticated' ? (
        <>
          <p>请先登录发起绑定的账号，再打开此邮件链接。</p>
          <Link to="/login">登录原账号</Link>
        </>
      ) : (
        <Form
          action={action}
          disabled={!services}
          submit={title}
          onSubmit={(form) => {
            const { password } = readForm(form);
            void action.run<unknown>(
              async () => {
                if (kind === 'verify') return services!.api.verify({ token });
                if (kind === 'reset') return services!.api.resetPassword({ token, password });
                const proof = await services!.api.reauthenticate({ method: 'password', password });
                return proof.ok ? services!.api.confirmLink(token) : proof;
              },
              async () => {
                form.reset();
                consume();
                if (kind === 'reset') await services!.changed(false);
              },
            );
          }}
        >
          {kind !== 'verify' && (
            <PasswordInput fresh={kind === 'reset'} label={kind === 'link' ? '原账号密码' : '新密码'} />
          )}
          <p>请确认由本人发起。链接在 30 分钟后失效且只能使用一次。</p>
        </Form>
      )}
      <div className={styles.links}>
        <Link to={kind === 'link' ? '/profile' : '/login'}>{kind === 'link' ? '返回我的' : '返回登录'}</Link>
        <Link to={kind === 'reset' ? '/account/forgot' : '/account/resend'}>重新申请邮件</Link>
      </div>
    </AccountLayout>
  );
}

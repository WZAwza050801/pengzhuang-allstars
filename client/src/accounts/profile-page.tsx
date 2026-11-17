import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import type { SessionList } from '../../../packages/contracts/src/accounts';
import { useAccount } from './context';
import { AccountLayout, Form, EmailInput, PasswordInput, readForm, useAccountAction, accountError } from './forms';
import styles from './pages.module.css';
import { LocalImportPanel } from './local-import';

export function AccountHub() {
  const { services, login, unavailable } = useAccount();
  if (unavailable)
    return (
      <AccountLayout title="账号连接中断">
        <p role="status">暂时无法确认账号状态，请重新连接。练习仍然可用。</p>
        <button className="pz-button" onClick={() => void services?.reconcile()}>
          重新连接
        </button>
        <Link to="/match?mode=practice">先练习</Link>
      </AccountLayout>
    );
  if (!services || login.status === 'unknown' || (login.status === 'loading' && !login.user))
    return (
      <AccountLayout title="正在恢复账号">
        <p role="status">正在确认登录状态…</p>
      </AccountLayout>
    );
  if (login.status === 'logout-pending' || login.status === 'signing-out')
    return (
      <AccountLayout title="确认退出">
        <p role="status">
          {login.status === 'signing-out' ? '正在退出…' : '退出结果尚未确认。重试会确认同一次退出操作。'}
        </p>
        <button
          className="pz-button"
          disabled={login.status === 'signing-out'}
          onClick={() =>
            void services.model.retry().then(() => {
              if (services.model.snapshot.status === 'anonymous') return services.changed(false);
            })
          }
        >
          重试退出
        </button>
      </AccountLayout>
    );
  if (login.status === 'error')
    return (
      <AccountLayout title="账号连接中断">
        <p role="status">暂时无法确认账号状态，请重新连接。练习仍然可用。</p>
        <button className="pz-button" onClick={() => void services.reconcile()}>
          重新连接
        </button>
        <Link to="/match?mode=practice">先练习</Link>
      </AccountLayout>
    );
  if (!login.user) return <Navigate to="/login" replace state={{ resume: { page: 'profile' } }} />;
  return <ProfilePage key={login.user.sessionId} />;
}
function ProfilePage() {
  const { services, login, options } = useAccount();
  const action = useAccountAction();
  const [devices, setDevices] = useState<SessionList | null>(null);
  const [policy, setPolicy] = useState<{ enabled: boolean; graceHours: number } | null>(null);
  const [identities, setIdentities] = useState<{ email: boolean; wechat: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([services!.api.list(), services!.api.deletionPolicy(), services!.api.identities()]).then(
      ([sessions, deletion, providers]) => {
        if (!active) return;
        if (sessions.ok) setDevices(sessions.data);
        if (deletion.ok) setPolicy(deletion.data);
        if (providers.ok) setIdentities(providers.data);
        for (const result of [sessions, deletion, providers])
          if (!result.ok) action.setNotice(accountError(result.error.code));
        if ([sessions, deletion, providers].some((result) => !result.ok && result.error.code === 'UNAUTHENTICATED'))
          void services!.changed(false);
      },
    );
    return () => {
      active = false;
    };
  }, [services]);
  const signOut = (all: boolean) =>
    void services!.model.logout(all).then(() => {
      if (services!.model.snapshot.status === 'anonymous') return services!.changed(false);
    });
  return (
    <AccountLayout title="我的账号">
      <p>{login.user?.profile?.nickname ?? '已登录账号'}</p>
      <LocalImportPanel key={login.user!.userId} />
      <section className={styles.section} aria-labelledby="devices-title">
        <h2 id="devices-title">登录设备</h2>
        {!devices ? (
          <p role="status">设备列表正在加载。加载失败可重新读取。</p>
        ) : (
          <ul className={styles.devices}>
            {devices.sessions.map((device) => (
              <li key={device.id}>
                <div>
                  <strong>
                    {
                      { desktop: '电脑浏览器', mobile: '手机浏览器', tablet: '平板浏览器', unknown: '其他设备' }[
                        device.deviceKind
                      ]
                    }
                    {device.isCurrent ? ' · 当前设备' : ''}
                  </strong>
                  <p>登录于 {new Date(device.createdAt).toLocaleString('zh-CN')}</p>
                </div>
                <button
                  className="pz-button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      () => services!.api.revoke(device.id),
                      async () => {
                        if (device.isCurrent) await services!.changed(false);
                        else {
                          const result = await services!.api.list();
                          if (result.ok) setDevices(result.data);
                          else action.setNotice(accountError(result.error.code));
                        }
                      },
                    )
                  }
                >
                  {device.isCurrent ? '退出当前设备' : '退出此设备'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          <button
            className="pz-button"
            disabled={action.busy}
            onClick={() => void action.run(() => services!.api.list(), setDevices)}
          >
            重新读取设备
          </button>
          {devices?.nextCursor && (
            <button
              className="pz-button"
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  () => services!.api.list(devices.nextCursor!),
                  (next) =>
                    setDevices({ sessions: [...devices.sessions, ...next.sessions], nextCursor: next.nextCursor }),
                )
              }
            >
              更多设备
            </button>
          )}
          <button className="pz-button" disabled={action.busy} onClick={() => signOut(false)}>
            退出登录
          </button>
          <button className="pz-button" disabled={action.busy} onClick={() => signOut(true)}>
            退出全部设备
          </button>
        </div>
        <p role="status">{action.notice}</p>
      </section>
      <section className={styles.section}>
        <h2>账号绑定</h2>
        {!identities ? (
          <p>正在读取绑定状态…</p>
        ) : (
          <>
            <p>
              邮箱：{identities.email ? '已绑定' : '未绑定'}；微信：{identities.wechat ? '已绑定' : '未绑定'}
              。绑定冲突不会自动合并资产。
            </p>
            {identities.email ? (
              <p>当前邮箱已绑定。此入口不更换已有邮箱。</p>
            ) : options?.emailEnabled ? (
              <BindEmail />
            ) : (
              <p>邮箱绑定暂不可用。</p>
            )}
            <p>纯微信身份的重新认证与微信绑定，请在支持微信登录的小游戏中操作。</p>
          </>
        )}
      </section>
      <section className={styles.section}>
        <h2>注销账号</h2>
        <p>
          提交后立即退出全部设备。等待期内可用邮箱和密码查询或取消；到期移除身份和个人资料，资产账本及比赛审计保留内部关联记录。注销后不能恢复原账号。
        </p>
        {policy?.enabled ? (
          <>
            <p>本次等待期：{policy.graceHours} 小时。</p>
            <Form
              action={action}
              submit="申请注销并退出"
              onSubmit={(form) => {
                const { password } = readForm(form);
                void action.run<unknown>(
                  async () => {
                    const proof = await services!.api.reauthenticate({ method: 'password', password });
                    return proof.ok ? services!.api.deleteAccount() : proof;
                  },
                  async () => {
                    form.reset();
                    await services!.changed(false);
                    window.location.replace('/account/deletion');
                  },
                  () => action.setNotice('未能确认注销结果。请使用下方“查询或取消注销”核实状态，再决定是否重新申请。'),
                );
              }}
            >
              <PasswordInput label="当前账号密码" />
              <label>
                输入 DELETE 确认注销
                <input name="confirm" required pattern="DELETE" autoComplete="off" />
              </label>
            </Form>
          </>
        ) : (
          <p>注销申请暂不可用。</p>
        )}
        <div className={styles.links}>
          <Link to="/account/deletion">查询或取消注销</Link>
        </div>
      </section>
    </AccountLayout>
  );
}
function BindEmail() {
  const { services } = useAccount();
  const action = useAccountAction();
  return (
    <Form
      action={action}
      submit="验证并发送绑定邮件"
      onSubmit={(form) => {
        const { email, password } = readForm(form);
        const currentPassword = String(new FormData(form).get('currentPassword') ?? '');
        void action.run<unknown>(
          async () => {
            const proof = await services!.api.reauthenticate({ method: 'password', password: currentPassword });
            return proof.ok ? services!.api.linkEmail({ provider: 'email', email, password }) : proof;
          },
          () => {
            form.reset();
            action.setNotice('申请已收到，请在当前浏览器打开绑定邮件。');
          },
        );
      }}
    >
      <PasswordInput name="currentPassword" label="当前账号密码" />
      <EmailInput label="要绑定的邮箱" />
      <PasswordInput fresh />
    </Form>
  );
}

export function DeletionRecoveryPage() {
  const { services, options } = useAccount();
  const action = useAccountAction();
  const [status, setStatus] = useState('');
  const [cancel, setCancel] = useState(false);
  return (
    <AccountLayout title="查询或取消注销">
      <p>使用原账号的邮箱和密码确认状态。取消成功后仍需重新登录；到期后的注销无法取消。微信身份请在小游戏操作。</p>
      <Form
        action={action}
        disabled={!services || !options?.emailEnabled}
        submit={cancel ? '确认取消注销' : '查询注销状态'}
        onSubmit={(form) => {
          const { email, password } = readForm(form);
          const proof = { method: 'password', email, password };
          if (cancel)
            void action.run(
              () => services!.api.cancelDeletion(proof),
              () => {
                setStatus('注销已取消，请重新登录。');
                setCancel(false);
                (form.elements.namedItem('password') as HTMLInputElement).value = '';
              },
            );
          else
            void action.run(
              () => services!.api.deletionStatus(proof),
              (data) => {
                setStatus(
                  data.status === 'pending'
                    ? `等待注销，计划于 ${new Date(data.executeAt!).toLocaleString('zh-CN')} 执行。`
                    : data.status === 'cancelled'
                      ? '注销已取消，可以重新登录。'
                      : '没有待执行的注销申请。',
                );
              },
            );
        }}
      >
        <EmailInput />
        <PasswordInput />
        <label>
          <input type="checkbox" checked={cancel} onChange={(event) => setCancel(event.target.checked)} />
          我希望取消待执行的注销
        </label>
      </Form>
      <p role="status">{status}</p>
      <div className={styles.links}>
        <Link to="/login">返回登录</Link>
      </div>
    </AccountLayout>
  );
}

import { createTransport } from 'nodemailer';
import type { RuntimeConfig } from '../../config/runtime';

export interface AccountMail {
  send(input: { to: string; purpose: 'email-verification' | 'password-reset' | 'identity-link'; token: string }): Promise<void>;
}
export class MailDeliveryError extends Error {
  constructor() {
    super('Account mail delivery failed');
  }
}

export function createAccountMail(config: RuntimeConfig): AccountMail {
  if (config.emailProvider === 'disabled') throw new Error('Account mail provider is disabled');
  const smtp = new URL(config.smtpUrl ?? 'smtp://127.0.0.1:1025');
  const deployed = config.mode === 'production' || config.mode === 'staging';
  if (!['smtp:', 'smtps:'].includes(smtp.protocol) || (deployed && smtp.protocol !== 'smtps:'))
    throw new Error('Invalid account SMTP transport');
  if (config.emailProvider === 'mailpit' && (deployed || !['127.0.0.1', 'localhost', '[::1]'].includes(smtp.hostname)))
    throw new Error('Mailpit must be local');
  const transport = createTransport({
    host: smtp.hostname.startsWith('[') ? smtp.hostname.slice(1, -1) : smtp.hostname,
    port: smtp.port ? Number(smtp.port) : smtp.protocol === 'smtps:' ? 465 : 25,
    secure: smtp.protocol === 'smtps:',
    requireTLS: config.emailProvider === 'smtp' && smtp.protocol === 'smtp:',
    ...(smtp.username
      ? { auth: { user: decodeURIComponent(smtp.username), pass: decodeURIComponent(smtp.password) } }
      : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send({ to, purpose, token }) {
      const url = new URL(purpose === 'email-verification' ? '/account/verify' : purpose === 'identity-link' ? '/account/link' : '/account/reset', config.publicOrigin);
      url.hash = token;
      try {
        const result = await transport.sendMail({
          from: config.mailFrom ?? 'no-reply@example.test',
          to,
          subject: purpose === 'email-verification' ? '验证碰撞全明星邮箱' : purpose === 'identity-link' ? '绑定碰撞全明星邮箱' : '重设碰撞全明星密码',
          text: `请在30分钟内打开以下链接完成操作。若非本人操作，请忽略此邮件。\n${url.toString()}\n`,
        });
        if (result.rejected?.length || !result.accepted?.length) throw new MailDeliveryError();
      } catch {
        throw new MailDeliveryError();
      }
    },
  };
}

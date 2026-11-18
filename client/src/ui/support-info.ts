const pages: [RegExp, string][] = [
  [/^\/$/, '大厅'],
  [/^\/login(?:\/|$)/, '登录'],
  [/^\/account(?:\/|$)/, '账号服务'],
  [/^\/(?:profile|settings)(?:\/|$)/, '我的与设置'],
  [/^\/lineup(?:\/|$)/, '持有阵容'],
  [/^\/room(?:\/|$)/, '好友房与账号比赛'],
  [/^\/match(?:\/|$)/, '本地练习'],
  [/^\/results?(?:\/|$)/, '比赛记录与结算'],
  [/^\/help(?:\/|$)/, '问题与反馈'],
];
/** Only a page category is collected. URL parameters, account data, browser storage and credentials are excluded. */
export function feedbackText(input: { pathname: string; online: boolean; service: string; note: string; at: string }) {
  const page = pages.find(([pattern]) => pattern.test(input.pathname))?.[1] ?? '其他页面';
  const service =
    ({ ready: '可用', maintenance: '维护中', outdated: '需要更新' } as Record<string, string>)[input.service] ??
    '尚未确认';
  return [
    `碰撞全明星 · 问题说明（尚未发送）`,
    `页面：${page}`,
    `网络：${input.online ? '在线' : '离线'}`,
    `服务：${service}`,
    `时间：${input.at}`,
    '',
    '复现步骤与期望：',
    input.note.trim().slice(0, 1000) || '请在发送前补充操作步骤、实际现象和期望。',
    '',
    '此说明不会自动提交；请由你发送给提供测试版本的人员。不要填写密码、验证码或登录凭据。',
  ].join('\n');
}

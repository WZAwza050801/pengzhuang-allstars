import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './style.css';
import './ui/components.css';
import { captureAccountLink } from './accounts/link-token';

captureAccountLink();

const app = document.getElementById('app');

if (!app) throw new Error('Missing #app root');

if (new URLSearchParams(window.location.search).get('legacy') === '1') {
  void import('./main');
} else {
  void import('./webApp')
    .then(({ WebApp }) => {
      createRoot(app, { onCaughtError: () => console.warn('页面显示中断，已提供恢复入口。') }).render(
        <StrictMode>
          <BrowserRouter>
            <WebApp />
          </BrowserRouter>
        </StrictMode>,
      );
    })
    .catch(() => {
      console.error('页面资源暂未能加载。');
      const panel = document.createElement('main'); panel.className = 'pz-ui pz-view-failure';
      const title = document.createElement('h1'); title.textContent = '页面资源暂未能加载'; title.tabIndex = -1;
      const hint = document.createElement('p'); hint.textContent = '请联网后重试。账号资料和已保存结果不会被清除。'; hint.setAttribute('role', 'alert');
      const retry = document.createElement('button'); retry.className = 'pz-button'; retry.textContent = '重新加载页面'; retry.onclick = () => window.location.reload();
      const back = document.createElement('a'); back.href = '/'; back.className = 'pz-button'; back.textContent = '返回大厅';
      panel.append(title, hint, retry, back); app.replaceChildren(panel); title.focus();
    });
}

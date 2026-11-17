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
      createRoot(app).render(
        <StrictMode>
          <BrowserRouter>
            <WebApp />
          </BrowserRouter>
        </StrictMode>,
      );
    })
    .catch((error: unknown) => {
      console.error('Web application failed to load', error);
      app.replaceChildren('页面加载失败，请刷新后重试。');
    });
}

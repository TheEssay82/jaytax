import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css';
import './styles/legacy.css'
import App from './App.tsx'

// 배포 직후 옛 화면이 사라진 파일 조각을 찾으면(Failed to fetch dynamically imported module) 한 번만 새로고침한다.
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('jt-chunk-reload')) return;
    sessionStorage.setItem('jt-chunk-reload', '1');
  } catch { /* 저장 불가여도 새로고침 */ }
  e.preventDefault();
  window.location.reload();
});
window.setTimeout(() => { try { sessionStorage.removeItem('jt-chunk-reload'); } catch { /* 무시 */ } }, 30000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

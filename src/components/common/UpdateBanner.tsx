// 새 버전 안내 — 배포 전에 열어 둔 화면은 옛 프로그램으로 돈다(2026-09-27 명진 이월본 v3 가 그랬다:
// 새 기능을 배포한 뒤 만들었는데 탭 색이 하나도 없었다). 5분마다·창으로 돌아올 때 첫 화면의 스크립트 이름을
// 견주어, 바뀌었으면 위에 띠를 띄운다. 개발 서버에서는 하지 않는다.
import { useEffect, useState } from 'react';

/** 첫 화면 HTML 에서 진입 스크립트 경로(해시 붙은 이름). */
function entryScript(html: string): string | null {
  return /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] ?? null;
}

export default function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const mine = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') ?? null;
    if (!mine) return;
    let off = false;
    const check = async () => {
      try {
        const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' });
        const now = entryScript(await res.text());
        if (!off && now && now !== mine) setStale(true);
      } catch { /* 오프라인 등 — 다음에 다시 본다 */ }
    };
    const t = window.setInterval(() => void check(), 5 * 60 * 1000);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => { off = true; window.clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);
  if (!stale) return null;
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 500, background: 'var(--navy)', color: '#fff', padding: '8px 16px',
      display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-2)', flexWrap: 'wrap',
    }}>
      새 버전이 배포됐습니다 — 지금 화면은 이전 버전입니다. 저장하지 않은 입력이 없으면 새로고침하세요.
      <button className="btn-sm" onClick={() => window.location.reload()}>새로고침</button>
    </div>
  );
}

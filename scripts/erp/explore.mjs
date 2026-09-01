/**
 * 인덕 ERP 화면 구조 탐색기 — 리포트 자동화를 짜기 위한 사전 조사용.
 *
 *   node scripts/erp/explore.mjs
 *
 * 하는 일
 *  1. 크롬을 띄우고 ERP 로 이동 → **사람이 직접 로그인**(비밀번호는 스크립트가 다루지 않는다)
 *  2. 회계관리 메뉴의 모든 항목과 이동 경로(onclick)를 수집
 *  3. 관심 화면(원장·거래전표·채권채무)의 폼 필드·버튼·프레임을 수집
 *  4. 조회는 하지 않는다. **읽기만 하고 저장·수정은 일절 하지 않는다.**
 *  결과: scripts/erp/_explore.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const ERP = 'http://induk.ibcenter.kr';
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'jaytax-erp-profile');
const OUT = path.join(process.cwd(), 'scripts', 'erp', '_explore.json');

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);

async function launch() {
  const base = {
    headless: false,
    acceptDownloads: true,
    args: ['--no-first-run', '--no-default-browser-check', '--start-maximized'],
  };
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, { ...base, channel: 'chrome' });
  } catch { /* 아래에서 실행파일 경로로 재시도 */ }
  for (const exe of CHROME_PATHS) {
    if (fs.existsSync(exe)) return chromium.launchPersistentContext(PROFILE_DIR, { ...base, executablePath: exe });
  }
  throw new Error('크롬을 찾지 못했습니다. CHROME_PATH 환경변수로 경로를 지정해 주세요.');
}

/** 로그인 폼이 사라질 때까지 기다린다(비밀번호는 사람이 입력). */
async function waitLogin(page) {
  const done = async () => (await page.locator('input[type="password"]').count().catch(() => 0)) === 0;
  if (await done()) return;
  console.log('\n  🔐 열린 크롬에서 직접 로그인해 주세요 (taxteam = 정남지 계정). 최대 5분 대기.\n');
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(1500);
    if (await done()) { console.log('  ✓ 로그인 확인\n'); return; }
  }
  throw new Error('로그인 대기 시간 초과');
}

/** 그 페이지의 메뉴·폼·버튼·프레임을 통째로 뜬다. */
const snapshot = (page) => page.evaluate(() => {
  const txt = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const menus = Array.from(document.querySelectorAll('[onclick]'))
    .map((e) => ({ label: txt(e).slice(0, 40), onclick: e.getAttribute('onclick') }))
    .filter((x) => x.label && x.onclick && x.onclick.includes('.jsp'));
  const forms = Array.from(document.forms).map((f) => ({
    name: f.name, action: f.getAttribute('action') || '', method: f.method,
    fields: Array.from(f.elements).map((e) => ({
      name: e.name || e.id, tag: e.tagName, type: e.type || '',
      options: e.tagName === 'SELECT' ? Array.from(e.options).slice(0, 40).map((o) => ({ t: o.text.trim(), v: o.value })) : undefined,
      value: e.tagName === 'SELECT' ? e.value : (e.type === 'text' ? e.value : undefined),
    })).filter((x) => x.name),
  }));
  const buttons = Array.from(document.querySelectorAll('input[type=button],input[type=submit],button'))
    .map((b) => ({ label: (b.value || txt(b)).slice(0, 30), onclick: b.getAttribute('onclick') || '' }))
    .filter((x) => x.label);
  // 페이지에 정의된 전역 함수 소스(이동 경로가 들어있다)
  const fns = {};
  for (const k of Object.keys(window)) {
    try {
      if (typeof window[k] === 'function' && /onclick|doSubmit|excel|xls|down/i.test(k)) {
        const s = String(window[k]);
        if (s.length < 3000) fns[k] = s.replace(/\s+/g, ' ');
      }
    } catch { /* 접근 불가 프로퍼티 무시 */ }
  }
  return { url: location.href, title: document.title, menus, forms, buttons, fns };
});

async function visit(ctx, url, label) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);
    const snap = await snapshot(page);
    console.log(`  · ${label} — 메뉴 ${snap.menus.length} · 폼 ${snap.forms.length} · 버튼 ${snap.buttons.length} · 함수 ${Object.keys(snap.fns).length}`);
    return { label, ...snap };
  } catch (e) {
    console.log(`  · ${label} — 실패: ${e.message.split('\n')[0]}`);
    return { label, url, error: e.message.split('\n')[0] };
  } finally {
    await page.close();
  }
}

const ctx = await launch();
const page = ctx.pages()[0] || await ctx.newPage();
// 팝업 경고창이 떠서 멈추지 않게 자동으로 닫는다(조회 전 단계라 안전).
ctx.on('page', (p) => p.on('dialog', (d) => d.dismiss().catch(() => {})));
page.on('dialog', (d) => d.dismiss().catch(() => {}));

await page.goto(`${ERP}/`, { waitUntil: 'domcontentloaded' });
await waitLogin(page);

console.log('  화면 구조를 수집합니다(조회는 하지 않습니다)…');
const pages = [];
pages.push(await visit(ctx, `${ERP}/apps/menu/tab_browse/tab_browse_dispatch.jsp?top_menu_id=FI`, '회계관리 메뉴'));
pages.push(await visit(ctx, `${ERP}/apps/common/buperiodselect.jsp`, '부서별원장-조건선택'));
pages.push(await visit(ctx, `${ERP}/apps/invjunpyo/ti/vat_ti_menu_bu.jsp`, '전자세금계산서 관리'));

// 메뉴에서 찾은 .jsp 경로를 추가로 훑는다(중복 제외, 최대 12개)
const seen = new Set(pages.map((p) => p.url));
const found = (pages[0].menus || [])
  .map((m) => (m.onclick.match(/'(\/[^']+\.jsp[^']*)'/) || [])[1])
  .filter(Boolean);
for (const rel of [...new Set(found)].slice(0, 12)) {
  const url = ERP + rel;
  if (seen.has(url)) continue;
  seen.add(url);
  pages.push(await visit(ctx, url, rel));
}

fs.writeFileSync(OUT, JSON.stringify({ collectedAt: new Date().toISOString(), pages }, null, 1), 'utf8');
console.log(`\n  ✓ 저장: ${OUT}`);
console.log('    이 파일을 Claude 에게 보여주면 자동화 코드를 채웁니다. 브라우저는 닫아도 됩니다.');
await ctx.close();

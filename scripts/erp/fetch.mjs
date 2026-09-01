/**
 * 인덕회계법인 ERP(IBCENTER) 리포트 수집기
 *
 *   npm run erp            → 리포트 다운로드(설정된 것만)
 *   npm run erp -- --explore  → 로그인 후 화면 구조를 떠서 저장(리포트 경로 파악용)
 *   npm run erp -- --month 2026-07 --dept 기장24팀
 *
 * 원칙
 *  · **비밀번호는 이 스크립트가 다루지 않는다.** 브라우저를 띄워 주고 사람이 직접 로그인한다.
 *  · 로그인 세션은 전용 크롬 프로필(userDataDir)에 남아 다음 달에는 로그인이 생략될 수 있다.
 *    프로필은 저장소 밖(LOCALAPPDATA)에 둔다 — 쿠키를 git 에 올리지 않기 위함.
 *  · 설치된 크롬을 그대로 쓴다(playwright-core + channel:'chrome'). 브라우저 내려받기 없음.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ERP_URL = 'http://induk.ibcenter.kr/';
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'jaytax-erp-profile');
const OUT_DIR = process.env.ERP_OUT_DIR
  || 'D:/Dropbox/4.영업관리/5520_기장사업부관리/기장24팀ERP데이터';

// ── 인자 ───────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);

const month = arg('month') || defaultMonth();      // 'YYYY-MM' — 기본은 전월
const dept = arg('dept', '기장24팀');
const explore = has('explore');
const doctor = has('doctor');

function defaultMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};

// ── 로그인 대기 ─────────────────────────────────────────
/** 로그인 폼이 사라질 때까지 기다린다. 비밀번호는 사람이 직접 넣는다. */
async function waitForLogin(page, timeoutMs = 5 * 60 * 1000) {
  const loggedIn = async () => {
    const pw = await page.locator('input[type="password"]').count().catch(() => 0);
    return pw === 0;
  };
  if (await loggedIn()) return true;
  console.log('\n  🔐 브라우저에서 직접 로그인해 주세요.');
  console.log('     (감사팀은 정우철 계정, taxteam 은 정남지 계정)');
  console.log('     로그인이 끝나면 이 창이 알아서 다음으로 넘어갑니다. 최대 5분 대기.\n');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(1500);
    if (await loggedIn()) { console.log('  ✓ 로그인 확인'); return true; }
  }
  throw new Error('로그인 대기 시간이 지났습니다.');
}

// ── 화면 구조 뜨기(리포트 경로 파악용) ───────────────────
async function explorePage(page) {
  const dump = await page.evaluate(() => {
    const pick = (els, f) => Array.from(els).map(f).filter((x) => x && x.label);
    const links = pick(document.querySelectorAll('a'), (a) => ({
      label: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      href: a.getAttribute('href') || '', onclick: (a.getAttribute('onclick') || '').slice(0, 120),
    }));
    const buttons = pick(document.querySelectorAll('button,input[type=button],input[type=submit]'), (b) => ({
      label: ((b.textContent || b.value || '')).replace(/\s+/g, ' ').trim().slice(0, 40),
      id: b.id || '', name: b.getAttribute('name') || '', onclick: (b.getAttribute('onclick') || '').slice(0, 120),
    }));
    const inputs = pick(document.querySelectorAll('input,select'), (i) => ({
      label: i.name || i.id || i.getAttribute('placeholder') || '', type: i.type || i.tagName, id: i.id || '',
    }));
    return { url: location.href, title: document.title, links, buttons, inputs };
  });
  const frames = page.frames().map((f) => ({ name: f.name(), url: f.url() }));
  return { ...dump, frames };
}

// ── 리포트 정의 ────────────────────────────────────────
// 실제 메뉴 경로·조회 폼은 로그인 후 화면을 봐야 채울 수 있다(--explore 로 뜬 결과로 채운다).
const REPORTS = [
  { key: 'ledger',   name: '총계정원장(외상매출금)', file: (ym) => `${ym.replace('-', '')}_${dept}_원장.xls` },
  { key: 'slip',     name: '거래전표리스트',         file: (ym) => `${ym.replace('-', '')}_${dept}_거래전표.xls` },
  { key: 'unpaid',   name: '부서별 미수금현황',      file: (ym) => `${ym.replace('-', '')}_${dept}_미수금.xls` },
];

// ── 크롬 띄우기 ────────────────────────────────────────
// playwright-core 는 브라우저를 내려받지 않으므로 설치된 크롬을 쓴다.
// channel:'chrome' 이 안 먹는 환경이 있어 실제 실행파일 경로로도 한 번 더 시도한다.
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

async function launchChrome() {
  const base = {
    headless: false,
    acceptDownloads: true,
    args: ['--no-first-run', '--no-default-browser-check', '--start-maximized', '--disable-gpu'],
  };
  const errs = [];
  const first = (msg) => String(msg).split('\n')[0];
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, { ...base, channel: 'chrome' });
  } catch (e) { errs.push(`channel:chrome → ${first(e.message)}`); }

  for (const exe of CHROME_PATHS) {
    if (!fs.existsSync(exe)) continue;
    try {
      console.log(`  크롬 실행파일로 재시도: ${exe}`);
      return await chromium.launchPersistentContext(PROFILE_DIR, { ...base, executablePath: exe });
    } catch (e) { errs.push(`${exe} → ${first(e.message)}`); }
  }
  throw new Error([
    '크롬을 띄우지 못했습니다.',
    ...errs.map((x) => '  ' + x),
    '',
    '  · 크롬이 설치돼 있는지 확인하세요.',
    '  · 경로가 특이하면 CHROME_PATH 환경변수로 지정해 주세요. (PowerShell)',
    '    $env:CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"; npm run erp -- --explore',
  ].join('\n'));
}

async function main() {
  if (doctor) {                       // 환경 점검 — 크롬을 띄우지 않고 상태만 출력
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    console.log('');
    console.log('[ERP 수집기 환경 점검]');
    console.log('  node           ', process.version);
    console.log('  playwright-core', pkg.devDependencies?.['playwright-core'] ?? '(설치 안 됨)');
    console.log('  프로필 경로    ', PROFILE_DIR, fs.existsSync(PROFILE_DIR) ? '(있음)' : '(없음 — 처음 실행 시 생성)');
    console.log('  저장 폴더      ', OUT_DIR, fs.existsSync(OUT_DIR) ? '(있음)' : '(없음 — 실행 시 생성)');
    console.log('  크롬 후보:');
    for (const exe of CHROME_PATHS) console.log(`    ${fs.existsSync(exe) ? '✓' : '✗'} ${exe}`);
    return;
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { from, to } = monthRange(month);
  console.log(`\n인덕 ERP 수집 — ${month} (${from} ~ ${to}) · 부서 ${dept}`);
  console.log(`  프로필 ${PROFILE_DIR}`);
  console.log(`  저장   ${OUT_DIR}`);

  const ctx = await launchChrome();
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    await page.goto(ERP_URL, { waitUntil: 'domcontentloaded' });
    await waitForLogin(page);

    if (explore) {
      const snap = await explorePage(page);
      const out = path.join(OUT_DIR, `_erp화면구조_${new Date().toISOString().slice(0, 10)}.json`);
      fs.writeFileSync(out, JSON.stringify(snap, null, 1), 'utf8');
      console.log(`\n  ✓ 화면 구조 저장: ${out}`);
      console.log(`    링크 ${snap.links.length} · 버튼 ${snap.buttons.length} · 입력 ${snap.inputs.length} · 프레임 ${snap.frames.length}`);
      console.log('    브라우저는 열어 둡니다. 리포트 화면으로 이동한 뒤 다시 --explore 를 돌리면 그 화면도 뜹니다.');
      console.log('    (창을 닫으면 스크립트가 끝납니다)');
      await page.waitForEvent('close', { timeout: 0 });
      return;
    }

    console.log('\n  ⚠ 리포트 자동 다운로드 경로가 아직 설정되지 않았습니다.');
    console.log('    먼저 `npm run erp -- --explore` 로 화면 구조를 떠 주세요.');
    for (const r of REPORTS) console.log(`      · ${r.name} → ${r.file(month)}`);
  } finally {
    if (!explore) await ctx.close();
  }
}

main().catch((e) => { console.error('실패:', e.message); process.exit(1); });

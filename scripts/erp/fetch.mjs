/**
 * 인덕회계법인 ERP(IBCENTER) 리포트 수집기
 *
 *   node scripts/erp/fetch.mjs                     전월분, 기장24팀
 *   node scripts/erp/fetch.mjs --month 2026-07
 *   node scripts/erp/fetch.mjs --bu 1024 --dept 기장24팀
 *   node scripts/erp/fetch.mjs --only slip,ledger  일부만
 *   node scripts/erp/fetch.mjs --doctor            환경 점검(크롬 안 띄움)
 *
 * 원칙
 *  · **비밀번호는 이 스크립트가 다루지 않는다.** 브라우저를 띄워 주고 사람이 직접 로그인한다.
 *  · 세션은 전용 크롬 프로필에 남아 다음 달엔 로그인이 생략될 수 있다(저장소 밖에 둔다).
 *  · 설치된 크롬을 그대로 쓴다(playwright-core). 브라우저 내려받기 없음.
 *  · **조회와 내려받기만 한다.** 저장·수정·전기 같은 쓰기 동작은 하지 않는다.
 *
 * 탭 하나만 쓴다
 *  엑셀을 한 번 받고 나면 크롬이 새 탭을 못 여는 상태가 되는 일이 있다
 *  (Target.createTarget: Failed to open a new tab). 그래서 리포트마다 탭을
 *  새로 열지 않고 **같은 탭을 계속 이동**시킨다. 그래도 세션이 죽으면
 *  브라우저를 다시 띄워 그 리포트만 재시도한다(프로필이 남아 보통 재로그인 불필요).
 *
 * 화면 구조(2026-09-01 탐색으로 확인)
 *  · 거래전표 리스트    /apps/invjunpyo/invjunpyonolist.jsp   엑셀 = xls_click()
 *  · 기준일자 미수금현황 /apps/sales/accfirm/arlistbybucode.jsp
 *  · 기간 미수금대장     /apps/sales/accfirm/arlistbybucode_flow.jsp  엑셀 = xls_click('1')
 *  · 부서별원장         /apps/common/buperiodselect.jsp → 조회 결과가 팝업으로 열린다
 *  엑셀은 어느 화면이든 숨은 폼(df)을 /apps/{모듈}/xls/xls_{화면}.jsp 로 POST 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const ERP = 'http://induk.ibcenter.kr';
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'jaytax-erp-profile');
const OUT_DIR = process.env.ERP_OUT_DIR
  || 'D:/Dropbox/4.영업관리/5520_기장사업부관리/기장24팀ERP데이터';
const NL = String.fromCharCode(10);

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);

const month = arg('month') || prevMonth();
const dept = arg('dept', '기장24팀');
const buCode = arg('bu', '1024');
const only = (arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const tag = month.replace('-', '');

function prevMonth() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function range(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, last, from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

const first = (m) => String(m).split(NL)[0];
/** 브라우저·탭이 통째로 죽어버린 종류의 오류인가 */
const isDead = (e) => /closed|crash|createTarget|Protocol error|disconnected/i.test(String(e && e.message));

async function launch() {
  const base = {
    headless: false,
    acceptDownloads: true,
    args: [
      '--no-first-run', '--no-default-browser-check', '--start-maximized',
      // 다운로드 말풍선이 뜨면서 이후 탭 생성이 막히는 사례가 있어 꺼 둔다
      '--disable-features=DownloadBubble,DownloadBubbleV2',
    ],
  };
  const errs = [];
  try { return await chromium.launchPersistentContext(PROFILE_DIR, { ...base, channel: 'chrome' }); }
  catch (e) { errs.push(`channel:chrome → ${first(e.message)}`); }
  for (const exe of CHROME_PATHS) {
    if (!fs.existsSync(exe)) continue;
    try { return await chromium.launchPersistentContext(PROFILE_DIR, { ...base, executablePath: exe }); }
    catch (e) { errs.push(`${exe} → ${first(e.message)}`); }
  }
  throw new Error(['크롬을 띄우지 못했습니다.', ...errs.map((x) => '  ' + x), '',
    '  · CHROME_PATH 환경변수로 크롬 경로를 지정할 수 있습니다.'].join(NL));
}

async function waitLogin(page) {
  const done = async () => (await page.locator('input[type="password"]').count().catch(() => 0)) === 0;
  if (await done()) return;
  console.log('');
  console.log('  🔐 열린 크롬에서 직접 로그인해 주세요. 최대 5분 대기.');
  console.log('     (taxteam = 정남지 계정 · 감사팀 = 정우철 계정)');
  console.log('');
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(1500);
    if (await done()) { console.log('  ✓ 로그인 확인'); return; }
  }
  throw new Error('로그인 대기 시간 초과');
}

/** 브라우저 하나 · 탭 하나를 들고 있다가, 죽으면 다시 띄운다. */
class Session {
  constructor() { this.ctx = null; this.page = null; }
  async open() {
    this.ctx = await launch();
    this.page = this.ctx.pages()[0] || await this.ctx.newPage();
    this.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await this.page.goto(`${ERP}/`, { waitUntil: 'domcontentloaded' });
    await waitLogin(this.page);
    return this.page;
  }
  alive() { return !!this.page && !this.page.isClosed(); }
  async reopen() {
    console.log('  ↻ 브라우저 세션이 끊겨 다시 띄웁니다…');
    await this.close();
    return this.open();
  }
  async close() {
    try { if (this.ctx) await this.ctx.close(); } catch { /* 이미 죽었으면 무시 */ }
    this.ctx = null; this.page = null;
  }
}

/** myform 의 필드를 채운다(select·input 공통). 없는 필드는 조용히 건너뛴다. */
const setFields = (page, values) => page.evaluate((vals) => {
  const f = document.forms['myform'];
  if (!f) return;
  for (const [k, v] of Object.entries(vals)) {
    const e = f.elements[k];
    if (e) e.value = v;
  }
}, values);

/** 엑셀 버튼을 눌러 내려받고 저장한다. */
async function grab(page, click, filename) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    // 제출 순간 실행 컨텍스트가 날아가며 나는 오류는 무시한다(다운로드는 이미 시작됨)
    page.evaluate(click).catch(() => {}),
  ]);
  const dest = path.join(OUT_DIR, filename);
  await dl.saveAs(dest);
  console.log(`  ✓ ${filename}  (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
  return dest;
}

const settle = async (p, ms = 2500) => {
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(ms);
};

// ── 리포트별 수집 (모두 같은 탭을 재사용한다) ──────────────
async function fetchSlip(page, r) {
  await page.goto(`${ERP}/apps/invjunpyo/invjunpyonolist.jsp?PageAction=OrderByNo`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await setFields(page, {
    FromDate: r.from, ToDate: r.to, MonthSelect: 'all', QuarterSelect: 'all',
    Search_BuCode: buCode, SearchBuCode: buCode,
  });
  await page.evaluate(() => window.search('search'));
  await settle(page);
  return grab(page, () => window.xls_click(), `${tag}_${dept}_거래전표.xls`);
}

async function fetchUnpaid(page, r) {
  await page.goto(`${ERP}/apps/sales/accfirm/arlistbybucode.jsp?menu=BCC&ReadBU=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await setFields(page, { reportDate: r.to, SearchReportDate: r.to, BuCode: buCode, SearchBuCode: buCode });
  await page.evaluate(() => window.doSubmit());
  await settle(page);
  return grab(page, () => window.xls_click(), `${tag}_${dept}_미수금현황.xls`);
}

async function fetchFlow(page, r) {
  await page.goto(`${ERP}/apps/sales/accfirm/arlistbybucode_flow.jsp?menu=BCC&ReadBU=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await setFields(page, {
    FromDate: r.from, ToDate: r.to, SearchFromDate: r.from, SearchToDate: r.to,
    Bucode: buCode, SearchBuCode: buCode,
  });
  await page.evaluate(() => window.doSubmit());
  await settle(page);
  return grab(page, () => window.xls_click('1'), `${tag}_${dept}_미수금대장.xls`);
}

async function fetchLedger(page, r) {
  await page.goto(`${ERP}/apps/common/buperiodselect.jsp`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  // 회계기수는 정산기간 7/1~익6/30 — 7~12월이면 그 해, 1~6월이면 전년이 시작연도
  await page.evaluate((startY) => {
    const g = document.forms['myform'].elements['Gisu'];
    if (!g) return;
    for (const o of g.options) if (o.text.includes(`${startY}-07-01`)) { g.value = o.value; break; }
    g.dispatchEvent(new Event('change', { bubbles: true }));
  }, r.m >= 7 ? r.y : r.y - 1);
  await page.waitForTimeout(900);

  const popup = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);
  await page.evaluate(({ y, m, last, bu }) => {
    const f = document.forms['myform'];
    const set = (n, v) => { const e = f.elements[n]; if (e) e.value = v; };
    set('JunpyoDateYear1', String(y)); set('JunpyoDateMonth1', String(m)); set('JunpyoDateDay1', '1');
    set('JunpyoDateYear2', String(y)); set('JunpyoDateMonth2', String(m)); set('JunpyoDateDay2', String(last));
    set('BuCode', bu);
    window.buttonPeriod_onclick();
  }, { y: r.y, m: r.m, last: r.last, bu: buCode });

  const win = await popup;                     // 결과가 팝업으로 뜨면 그쪽에서, 아니면 같은 탭에서
  const target = win || page;
  if (win) win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await settle(target);
  try {
    return await grab(target, () => window.xls_click(), `${tag}_${dept}_원장.xls`);
  } finally {
    if (win) await win.close().catch(() => {});  // 팝업만 닫는다(본 탭은 그대로 둔다)
  }
}

const REPORTS = {
  slip: ['거래전표 리스트', fetchSlip],
  unpaid: ['기준일자 미수금현황', fetchUnpaid],
  flow: ['기간 미수금대장', fetchFlow],
  ledger: ['부서별원장', fetchLedger],
};

async function main() {
  if (has('doctor')) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    console.log('');
    console.log('[ERP 수집기 환경 점검]');
    console.log('  node           ', process.version);
    console.log('  playwright-core', pkg.devDependencies?.['playwright-core'] ?? '(설치 안 됨)');
    console.log('  프로필 경로    ', PROFILE_DIR, fs.existsSync(PROFILE_DIR) ? '(있음 — 세션이 남아있을 수 있음)' : '(없음)');
    console.log('  저장 폴더      ', OUT_DIR, fs.existsSync(OUT_DIR) ? '(있음)' : '(없음 — 실행 시 생성)');
    console.log('  크롬 후보:');
    for (const exe of CHROME_PATHS) console.log(`    ${fs.existsSync(exe) ? '✓' : '✗'} ${exe}`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const r = range(month);
  console.log('');
  console.log(`인덕 ERP 수집 — ${month} (${r.from} ~ ${r.to}) · ${dept}[${buCode}]`);
  console.log(`  저장 ${OUT_DIR}`);

  const s = new Session();
  const done = [], failed = [];
  try {
    await s.open();
    console.log('');
    for (const [key, [label, fn]] of Object.entries(REPORTS)) {
      if (only.length && !only.includes(key)) continue;
      console.log(`  ${label} …`);
      if (!s.alive()) await s.reopen();
      try {
        done.push(await fn(s.page, r));
      } catch (e) {
        if (!isDead(e)) { failed.push(key); console.log(`  ✗ ${label} — ${first(e.message)}`); continue; }
        // 브라우저가 죽은 경우만 한 번 다시 띄워 재시도한다
        try {
          await s.reopen();
          done.push(await fn(s.page, r));
        } catch (e2) { failed.push(key); console.log(`  ✗ ${label} — ${first(e2.message)}`); }
      }
    }
  } finally { await s.close(); }

  const names = failed.map((k) => REPORTS[k][0]);
  console.log('');
  console.log(`  받은 파일 ${done.length}개${failed.length ? ` · 실패 ${failed.length}개 (${names.join(', ')})` : ''}`);
  if (failed.length) console.log(`  실패분만 다시: node scripts/erp/fetch.mjs --month ${month} --only ${failed.join(',')}`);
  console.log('  jaytax 기장등청구관리에서 업로드하세요.');
  console.log('');
}

main().catch((e) => { console.error(''); console.error('실패:', e.message); process.exit(1); });

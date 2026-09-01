/**
 * 인덕회계법인 ERP(IBCENTER) 리포트 수집기
 *
 *   node scripts/erp/fetch.mjs                     전월분, 기장24팀
 *   node scripts/erp/fetch.mjs --month 2026-07
 *   node scripts/erp/fetch.mjs --bu 1024 --dept 기장24팀
 *   node scripts/erp/fetch.mjs --only slip,ledger  일부만
 *   node scripts/erp/fetch.mjs --depts            이 계정이 볼 수 있는 부서·코드 확인
 *   node scripts/erp/fetch.mjs --profile audit --bu 0205 --dept 감사팀 --month 2026-07
 *   (--out 으로 저장 폴더를 바꿀 수 있습니다)
 *   node scripts/erp/fetch.mjs --inspect unpaid   조회 조건 배우기(사람이 한 번 조회)
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
 * 화면 구조(2026-09-01 확인)
 *  · 거래전표 리스트    /apps/invjunpyo/invjunpyonolist.jsp          엑셀 = xls_click()
 *  · 기준일자 미수금현황 /apps/sales/accfirm/arlistbybucode.jsp       엑셀 = xls_click()
 *  · 기간 미수금대장     /apps/sales/accfirm/arlistbybucode_flow.jsp  엑셀 = xls_click('1')
 *  · 부서별원장         /apps/common/buperiodselect.jsp → 조회 결과가 팝업으로 열린다
 *
 *  ※ 버튼 이름에 속지 말 것. 목록 화면의 **[검색] 이 질의**이고(`search('search')`),
 *    **[조회] 는 고른 행의 상세로 들어가는 버튼**이다(`doSubmit()`). doSubmit 을 질의로
 *    부르면 rowcount 가 0이라 "레코드가 없습니다"만 뜨고 끝난다.
 *  엑셀은 어느 화면이든 숨은 폼(df)을 /apps/{모듈}/xls/xls_{화면}.jsp 로 POST 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const ERP = 'http://induk.ibcenter.kr';
const NL = String.fromCharCode(10);

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);

/**
 * 계정별 크롬 프로필 — taxteam 은 정남지, 감사팀은 정우철 계정이라 세션을 나눠 둔다.
 * 하나로 쓰면 팀을 바꿀 때마다 로그아웃했다 다시 들어가야 한다.
 *   --profile tax(기본) | audit | 아무 이름
 */
const profile = arg('profile', 'tax');
const BASE = process.env.LOCALAPPDATA || os.tmpdir();
// 예전에 쓰던 단일 프로필이 남아 있으면 tax 는 그걸 그대로 쓴다(다시 로그인하지 않게).
const LEGACY = path.join(BASE, 'jaytax-erp-profile');
const PROFILE_DIR = (profile === 'tax' && fs.existsSync(LEGACY))
  ? LEGACY : path.join(BASE, `jaytax-erp-${profile}`);
// 팀마다 폴더가 다르다. --out 으로 언제든 바꿀 수 있다.
const OUT_BY_PROFILE = {
  tax: 'D:/Dropbox/4.영업관리/5520_기장사업부관리/기장24팀ERP데이터',
  audit: 'D:/Dropbox/4.영업관리/2본부5팀',
};
const OUT_DIR = arg('out') || process.env.ERP_OUT_DIR || OUT_BY_PROFILE[profile] || OUT_BY_PROFILE.tax;

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
  console.log(`  🔐 열린 크롬에서 직접 로그인해 주세요. 최대 5분 대기. [프로필 ${profile}]`);
  console.log('     taxteam = 정남지 계정 · 감사팀 = 정우철 계정');
  console.log('     프로필이 계정별로 나뉘어 있어 한 번 로그인하면 다음부터는 생략됩니다.');
  console.log('');
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(1500);
    if (await done()) { console.log('  ✓ 로그인 확인'); return; }
  }
  throw new Error('로그인 대기 시간 초과');
}

/**
 * ERP 가 띄우는 확인창은 **받는다**.
 * 엑셀 버튼이 "받으시겠습니까?" 같은 confirm 을 띄우는 화면이 있어, 닫아버리면
 * 다운로드가 시작되지 않는다. 조회 전용 화면이라 확인을 눌러도 저장·수정은 없다.
 * 무슨 창이 떴는지는 화면에 찍어 둔다(조회 조건이 틀렸을 때 여기로 드러난다).
 */
const handleDialogs = (p) => p.on('dialog', async (d) => {
  console.log(`    · ERP 알림: ${d.message().replace(/\s+/g, ' ').slice(0, 120)}`);
  await d.accept().catch(() => d.dismiss().catch(() => {}));
});

/** 브라우저 하나 · 탭 하나를 들고 있다가, 죽으면 다시 띄운다. */
class Session {
  constructor() { this.ctx = null; this.page = null; }
  async open() {
    this.ctx = await launch();
    this.ctx.on('page', handleDialogs);          // 팝업 창에서 뜨는 확인창까지
    this.page = this.ctx.pages()[0] || await this.ctx.newPage();
    handleDialogs(this.page);
    await this.page.goto(`${ERP}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
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

// ERP 화면은 열 때부터 질의를 돌려 응답이 느리다(30초를 넘기는 화면이 있다).
// 그래서 어디서나 넉넉히 기다리고, "폼과 엑셀 함수가 준비됐는지"로 완료를 판단한다.
const NAV_MS = 180000;   // 화면 열기·조회
const DL_MS = 180000;    // 엑셀 생성·다운로드

/** 응답 헤더만 받고 넘어간다(본문 생성이 느려도 멈추지 않게). */
const open = (page, url) => page.goto(url, { waitUntil: 'commit', timeout: NAV_MS });

/** myform 과 xls_click 이 만들어질 때까지 기다린다. */
const ready = (page, ms = NAV_MS) => page.waitForFunction(
  () => !!document.forms['myform'] && typeof window.xls_click === 'function',
  undefined, { timeout: ms },
);

/** 조회 버튼을 누르고, 결과 화면이 다 뜰 때까지 기다린다. */
async function submitAndWait(page, fn) {
  await page.evaluate(fn).catch(() => {});   // 제출 순간 컨텍스트가 날아가는 건 정상
  await page.waitForTimeout(1500);
  await page.waitForLoadState('load', { timeout: NAV_MS }).catch(() => {});
  await ready(page);
  await page.waitForTimeout(1500);
  // 조회가 실제로 자료를 물어왔는지 눈으로 확인할 수 있게 행 수를 찍는다.
  const rows = await page.evaluate(() => document.querySelectorAll('tr').length).catch(() => -1);
  console.log(`    · 조회 완료 — 표 ${rows}행`);
}

/**
 * 엑셀은 현재 탭이 아니라 **새 창으로 떨어지는 화면**이 있다.
 * 그래서 이 브라우저의 모든 탭(앞으로 열릴 탭 포함)에서 다운로드를 기다린다.
 */
function waitDownloadAnywhere(ctx, ms) {
  return new Promise((resolve, reject) => {
    const seen = new Set();
    const onDownload = (d) => { cleanup(); resolve(d); };
    const attach = (p) => { if (!seen.has(p)) { seen.add(p); p.on('download', onDownload); } };
    const onPage = (p) => attach(p);
    const timer = setTimeout(() => { cleanup(); reject(new Error(`다운로드가 시작되지 않았습니다(${ms / 1000}초 대기)`)); }, ms);
    function cleanup() {
      clearTimeout(timer);
      ctx.off('page', onPage);
      for (const p of seen) p.off('download', onDownload);
    }
    ctx.on('page', onPage);
    ctx.pages().forEach(attach);
  });
}

/**
 * 엑셀 버튼을 눌러 내려받고 저장한다.
 * clicks 를 순서대로 시도한다 — 인자 형태가 화면마다 달라 첫 시도가 빗나갈 수 있다.
 */
async function grab(page, clicks, filename) {
  const ctx = page.context();
  const list = Array.isArray(clicks) ? clicks : [clicks];
  let lastErr = null;
  for (let i = 0; i < list.length; i++) {
    const last = i === list.length - 1;
    try {
      const wait = waitDownloadAnywhere(ctx, last ? DL_MS : 45000);
      await page.evaluate(list[i]).catch(() => {});   // 제출로 컨텍스트가 날아가는 건 정상
      const dl = await wait;
      const dest = path.join(OUT_DIR, filename);
      await dl.saveAs(dest);
      console.log(`  ✓ ${filename}  (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
      return dest;
    } catch (e) {
      lastErr = e;
      if (!last) console.log('    · 엑셀 호출 재시도…');
    }
  }
  await dumpExcelHints(page);
  throw lastErr;
}

/** 다운로드가 끝내 안 되면, 그 화면의 엑셀 버튼이 실제로 뭘 하는지 찍어 둔다. */
async function dumpExcelHints(page) {
  const info = await page.evaluate(() => {
    const txt = (b) => (b.value || b.textContent || b.alt || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    return {
      url: location.href,
      fn: typeof window.xls_click === 'function'
        ? String(window.xls_click).replace(/\s+/g, ' ').slice(0, 500) : '(xls_click 없음)',
      btns: Array.from(document.querySelectorAll('input[type=button],input[type=image],button,a'))
        .map((b) => `${txt(b)} :: ${(b.getAttribute('onclick') || '').replace(/\s+/g, ' ').slice(0, 140)}`)
        .filter((s) => /xls|excel|엑셀/i.test(s)).slice(0, 6),
    };
  }).catch(() => null);
  if (!info) return;
  console.log(`    ▸ 화면 ${info.url.replace(ERP, '')}`);
  console.log(`    ▸ xls_click = ${info.fn}`);
  for (const b of info.btns) console.log(`    ▸ 버튼 ${b}`);
}

/** 화면에 있는 엑셀 버튼을 직접 누르는 마지막 수단. */
const clickExcelButton = () => {
  const btns = Array.from(document.querySelectorAll('input[type=button],input[type=image],button,a'));
  const b = btns.find((x) => /xls_click|excel/i.test(x.getAttribute('onclick') || ''));
  if (b) b.click();
};

// ── 리포트별 수집 (모두 같은 탭을 재사용한다) ──────────────
async function fetchSlip(page, r) {
  await open(page, `${ERP}/apps/invjunpyo/invjunpyonolist.jsp?PageAction=OrderByNo`);
  await ready(page);
  await setFields(page, {
    FromDate: r.from, ToDate: r.to, MonthSelect: 'all', QuarterSelect: 'all',
    Search_BuCode: buCode, SearchBuCode: buCode,
  });
  await submitAndWait(page, () => window.search('search'));
  return grab(page, [() => window.xls_click(), clickExcelButton], `${tag}_${dept}_거래전표.xls`);
}

async function fetchUnpaid(page, r) {
  await open(page, `${ERP}/apps/sales/accfirm/arlistbybucode.jsp?menu=BCC&ReadBU=1`);
  await ready(page);
  await setFields(page, { SearchReportDate: r.to, SearchBuCode: buCode });
  await submitAndWait(page, () => window.search('search'));
  return grab(page, [() => window.xls_click(), clickExcelButton], `${tag}_${dept}_미수금현황.xls`);
}

async function fetchFlow(page, r) {
  await open(page, `${ERP}/apps/sales/accfirm/arlistbybucode_flow.jsp?menu=BCC&ReadBU=1`);
  await ready(page);
  await setFields(page, { SearchFromDate: r.from, SearchToDate: r.to, SearchBuCode: buCode });
  await submitAndWait(page, () => window.search('search'));
  // 엑셀 = gubun 1, Excel2 = gubun 2. 우리가 쓰는 건 1.
  return grab(page, [() => window.xls_click('1')], `${tag}_${dept}_미수금대장.xls`);
}

async function fetchLedger(page, r) {
  await open(page, `${ERP}/apps/common/buperiodselect.jsp`);
  await page.waitForFunction(() => !!document.forms['myform'], undefined, { timeout: NAV_MS });
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
  await target.waitForLoadState('load', { timeout: NAV_MS }).catch(() => {});
  await ready(target);
  await target.waitForTimeout(1500);
  try {
    return await grab(target, [() => window.xls_click(), clickExcelButton], `${tag}_${dept}_원장.xls`);
  } finally {
    if (win) await win.close().catch(() => {});  // 팝업만 닫는다(본 탭은 그대로 둔다)
  }
}

/**
 * 거래처 마스터. 부서·기간 조건이 없는 전사 목록이라 **코드 매핑의 원천**이다.
 * 원장에는 거래처코드만 있고 사업자번호가 없어서, 코드↔사업자번호를 여기서 얻는다.
 */
async function fetchClients(page) {
  await open(page, `${ERP}/apps/code/cvcode/cvlist.jsp?menu=BCC`);
  await ready(page);
  await submitAndWait(page, () => window.search('search'));
  return grab(page, [() => window.xls_click(), clickExcelButton], `${tag}_ERP거래처마스터.xls`);
}

/**
 * 부서 목록 — 로그인한 계정이 볼 수 있는 부서와 그 코드를 찍는다.
 * 감사팀 부서코드를 몰라서 자료를 못 받던 문제를 이걸로 푼다(기장24팀=1024 만 알고 있었다).
 */
async function listDepts(page) {
  await open(page, `${ERP}/apps/sales/accfirm/arlistbybucode.jsp?menu=BCC&ReadBU=1`);
  await ready(page);
  const opts = await page.evaluate(() => {
    const sel = document.forms['myform']?.elements['SearchBuCode'];
    if (!sel || !sel.options) return [];
    return Array.from(sel.options).map((o) => ({ v: String(o.value), t: o.text.trim() }));
  });
  console.log('');
  console.log(`  이 계정이 볼 수 있는 부서 ${opts.length}개:`);
  for (const o of opts) console.log(`    ${String(o.v).padEnd(8)} ${o.t}`);
  console.log('');
  console.log('  받을 때는 이렇게 씁니다:');
  console.log(`    node scripts/erp/fetch.mjs --profile ${profile} --bu <코드> --dept <폴더에 쓸 이름> --month ${month}`);
  console.log('');
}

const REPORTS = {
  slip: ['거래전표 리스트', fetchSlip],
  unpaid: ['기준일자 미수금현황', fetchUnpaid],
  flow: ['기간 미수금대장', fetchFlow],
  ledger: ['부서별원장', fetchLedger],
  clients: ['거래처 마스터', fetchClients],
};

// 매달 받을 필요가 없는 것 — `--only clients` 로 부를 때만 받는다.
// 거래처 마스터는 전사 7만 건·90MB 라서 월마다 쌓으면 드롭박스만 무거워진다.
// 새 거래처의 ERP 코드를 붙일 때만 한 번씩 받으면 된다.
const OPT_IN = new Set(['clients']);

const URLS = {
  slip: `${ERP}/apps/invjunpyo/invjunpyonolist.jsp?PageAction=OrderByNo`,
  unpaid: `${ERP}/apps/sales/accfirm/arlistbybucode.jsp?menu=BCC&ReadBU=1`,
  flow: `${ERP}/apps/sales/accfirm/arlistbybucode_flow.jsp?menu=BCC&ReadBU=1`,
  ledger: `${ERP}/apps/common/buperiodselect.jsp`,
  clients: `${ERP}/apps/code/cvcode/cvlist.jsp?menu=BCC`,
};

// ── 조건 배우기 ───────────────────────────────────────────
// 화면마다 조회 조건의 필드 이름·값 형식이 달라 추측이 잘 빗나간다.
// 사람이 한 번 직접 조건을 넣고 조회하면, 그때 폼에 들어간 값을 그대로 읽어 온다.
//   node scripts/erp/fetch.mjs --inspect unpaid

const dumpForms = (page) => page.evaluate(() => {
  const out = [];
  for (const f of document.forms) {
    const fields = [];
    for (const e of f.elements) {
      const n = e.name || e.id;
      if (!n) continue;
      const sel = e.tagName === 'SELECT' && e.selectedIndex >= 0 ? e.options[e.selectedIndex].text.trim() : '';
      fields.push({ n, tag: e.tagName, type: e.type || '', v: String(e.value ?? ''), sel });
    }
    out.push({ name: f.name || '(이름없음)', action: f.getAttribute('action') || '', fields });
  }
  return { url: location.href, rows: document.querySelectorAll('tr').length, forms: out };
});

const printForms = (d, title) => {
  console.log('');
  console.log(`  [${title}] ${d.url.replace(ERP, '')} · 표 ${d.rows}행`);
  for (const f of d.forms) {
    if (!f.fields.length) continue;
    console.log(`   폼 ${f.name}${f.action ? ` → ${f.action}` : ''}`);
    for (const x of f.fields) {
      const val = x.v === '' ? '' : `= ${x.v}`;
      console.log(`     ${x.n.padEnd(24)} ${x.tag.toLowerCase()}/${x.type} ${val}${x.sel ? `  (${x.sel})` : ''}`);
    }
  }
};

async function inspect(key) {
  if (!URLS[key]) throw new Error(`--inspect 에는 ${Object.keys(URLS).join(', ')} 중 하나를 적어 주세요.`);
  const s = new Session();
  try {
    await s.open();
    await open(s.page, URLS[key]);
    await s.page.waitForFunction(() => !!document.forms['myform'], undefined, { timeout: NAV_MS });
    await s.page.waitForTimeout(1500);
    printForms(await dumpForms(s.page), `${REPORTS[key][0]} — 열었을 때`);

    console.log('');
    console.log('  ────────────────────────────────────────────────');
    console.log('  이제 **브라우저에서 직접** 원하는 조건을 넣고 조회를 눌러 주세요.');
    console.log('  (엑셀은 누르지 않으셔도 됩니다. 자료가 나온 상태면 됩니다.)');
    console.log('  다 되면 이 창으로 돌아와 Enter 를 눌러 주세요.');
    console.log('  ────────────────────────────────────────────────');
    await new Promise((res) => process.stdin.once('data', res).resume());

    const page = s.ctx.pages().find((p) => !p.isClosed()) || s.page;
    printForms(await dumpForms(page), `${REPORTS[key][0]} — 조회한 뒤`);
    console.log('');
    console.log('  위 출력을 그대로 Claude 에게 붙여 주시면 조건을 코드에 넣습니다.');
    console.log('');
  } finally { await s.close(); }
}

async function main() {
  if (has('doctor')) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    console.log('');
    console.log('[ERP 수집기 환경 점검]');
    console.log('  node           ', process.version);
    console.log('  playwright-core', pkg.devDependencies?.['playwright-core'] ?? '(설치 안 됨)');
    console.log('  프로필         ', profile, '→', PROFILE_DIR, fs.existsSync(PROFILE_DIR) ? '(있음 — 세션이 남아있을 수 있음)' : '(없음)');
    console.log('  저장 폴더      ', OUT_DIR, fs.existsSync(OUT_DIR) ? '(있음)' : '(없음 — 실행 시 생성)');
    console.log('  크롬 후보:');
    for (const exe of CHROME_PATHS) console.log(`    ${fs.existsSync(exe) ? '✓' : '✗'} ${exe}`);
    return;
  }

  if (has('depts')) {
    const s = new Session();
    try { await s.open(); await listDepts(s.page); }
    finally { await s.close(); }
    return;
  }
  if (has('inspect')) return inspect(arg('inspect'));

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
      if (only.length ? !only.includes(key) : OPT_IN.has(key)) continue;
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

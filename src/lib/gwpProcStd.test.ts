// 2120A 주요 감사절차 표준 — 판정·업종 거르기·자리표시·기본 줄(사용자 2026-09-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagsOf, suggestProc, guessIndustry, stdAccountOf, missingProcs, fmtWon, type ProcStd } from './gwpProcStd';

let n = 0;
const S = (account: string, trigger: ProcStd['trigger'], industry: string, body: string, aliases: string[] = [], sort = 10): ProcStd =>
  ({ id: String(n++), account, aliases, trigger, industry, body, sort, active: true, note: null });
const STD: ProcStd[] = [
  S('*', 'Material', '공통', '주요 항목 증빙테스트(E/O, A)', [], 900),
  S('*', 'Unexpected', '공통', '전기 대비 {증감액}({증감률}) 변동 원인 파악(V)', [], 902),
  S('매출액', 'Material', '공통', '매출 증빙테스트(E/O, A)', ['영업수익']),
  S('매출액', 'Material', '운송·물류업', '결산일 현재 미정산 운송건 매출 인식 검토(C)', ['영업수익'], 13),
  S('매출액', 'Material', '제조업', '출하·인도 조건 확인(E/O)', ['영업수익'], 13),
  S('미수수익', '항상', '공통', '미수수익 재계산(A)'),
  S('감가상각누계액', 'Material', '공통', '감가상각비 재계산 및 누계액 대사(A)'),
  S('유형자산', 'Material', '공통', '취득·처분 증빙테스트(E/O, A)', ['기계장치']),
];

test('판정 — Material 은 잔액 > 중요성, Unexpected 는 증감 > 중요성×90%', () => {
  assert.deepEqual(flagsOf({ prev: 100, cur: 250 }, 200), { material: true, unexpected: false });
  assert.deepEqual(flagsOf({ prev: 100, cur: 150 }, 50), { material: true, unexpected: true });   // 증감 50 > 45
  assert.deepEqual(flagsOf({ prev: 100, cur: 144 }, 50), { material: true, unexpected: false });  // 증감 44 < 45
  assert.deepEqual(flagsOf({ prev: 1, cur: 2 }, null), { material: false, unexpected: false });
});

test('업종 줄은 그 업종 회사에만 — 운송건 문구가 제조업 회사에 붙지 않는다(평안정공)', () => {
  const f = { material: true, unexpected: false };
  const mfg = suggestProc({ label: '매출액', prev: 1e9, cur: 2e9 }, f, STD, '제조업')!;
  assert.match(mfg, /① 매출 증빙테스트/); assert.match(mfg, /② 출하·인도/); assert.doesNotMatch(mfg, /운송건/);
  const trs = suggestProc({ label: '영업수익', prev: 1e9, cur: 2e9 }, f, STD, '운송·물류업')!;
  assert.match(trs, /운송건/); assert.doesNotMatch(trs, /출하/);
});

test('계정별 줄이 없는 판정은 기본(*) 줄 — 자리표시는 그 줄 금액으로', () => {
  const t = suggestProc({ label: '미수금', prev: 2.6e8, cur: 0.7e8 }, { material: false, unexpected: true }, STD, '제조업')!;
  assert.equal(t, '① 전기 대비 -1.9억원(-73.1%) 변동 원인 파악(V)');
  assert.equal(suggestProc({ label: '미수금', prev: 1, cur: 1 }, { material: false, unexpected: false }, STD, '제조업'), null);
  // 「항상」 줄은 판정이 없어도
  assert.equal(suggestProc({ label: '미수수익', prev: 1, cur: 1 }, { material: false, unexpected: false }, STD, '제조업'), '① 미수수익 재계산(A)');
});

test('표준 계정 찾기 — 차감 계정 앞머리 · 동의어 · 분류 순', () => {
  assert.equal(stdAccountOf({ label: '감가상각누계액-기계장치' }, STD), '감가상각누계액');
  assert.equal(stdAccountOf({ label: '기계장치' }, STD), '유형자산');
  assert.equal(stdAccountOf({ label: '금형', group: '(1)  유  형  자  산' }, STD), '유형자산');
  assert.equal(stdAccountOf({ label: '복리후생비', group: 'Ⅳ. 판매비와관리비' }, STD), null);
});

test('업종 추정 · 금액 표기 · 빈 절차 찾기(분류 줄 절차가 덮으면 됨)', () => {
  assert.equal(guessIndustry(['재고자산', '원재료', '제품']), '제조업');
  assert.equal(guessIndustry(['투자주식'], '오큘러스제1호사모투자합자회사'), '투자회사');
  assert.equal(guessIndustry(['상품', '상품매출원가']), '도소매업');
  assert.equal(guessIndustry(['용역매출']), '서비스업');
  assert.equal(fmtWon(1_320_000_000), '+13.2억원'); assert.equal(fmtWon(-45_000_000), '-45백만원');
  const d = { hasProc: true, groupProc: { '(1) 유형자산': '① 취득·처분' }, rows: [
    { label: '기계장치', group: '(1) 유형자산', prev: 1, cur: 500 },
    { label: '선급금', group: 'Ⅰ. 유동자산', prev: 1, cur: 500 },
    { label: '매출채권', group: 'Ⅰ. 유동자산', prev: 1, cur: 500, proc: '조회' },
  ] };
  assert.deepEqual(missingProcs(d, 100), ['선급금']);
  assert.deepEqual(missingProcs(d, null), []);
});

test('표준 절차 — 두 해 빈 줄엔 없고, 분류로만 찾은 판관비 줄엔 「항상」을 붙이지 않는다(아비즈)', () => {
  const none = { material: false, unexpected: false };
  assert.equal(suggestProc({ label: '미수수익', prev: null, cur: null }, none, STD, '제조업'), null);
  const g = { label: '여비교통비', group: 'Ⅳ. 판매비와관리비', prev: 1, cur: 1 };
  assert.equal(suggestProc(g, none, [...STD, { id: 'z', account: '판매비와관리비', aliases: [], trigger: '항상', industry: '공통', body: '월별 분석(V)', sort: 1, active: true, note: null }], '제조업'), null);
  assert.equal(stdAccountOf({ label: '보증금(유동)' }, [...STD, { id: 'y', account: '보증금', aliases: [], trigger: 'Material', industry: '공통', body: 'x', sort: 1, active: true, note: null }]), '보증금');
});

import { bundlesOf, fillStdProcs } from './gwpProcStd';
test('판정 — 빈칸은 0(엑셀 I·J 와 같게): 전기에만 있던 계정도 Unexpected, 두 해 빈 줄은 판정 없음', () => {
  assert.deepEqual(flagsOf({ prev: 1770, cur: null }, 1000), { material: false, unexpected: true });
  assert.deepEqual(flagsOf({ prev: null, cur: 1500 }, 1000), { material: true, unexpected: true });
  assert.deepEqual(flagsOf({ prev: null, cur: null }, 1), { material: false, unexpected: false });
});

test('묶음 — 유형자산은 분류 줄에 한 번, 재고자산 한 줄은 그 줄에, 판정 줄이 모두 덮이면 빠진 곳 없음(사용자 2026-10-01)', () => {
  const G = '(1)  유  형  자  산';
  const R = (key: string, label: string, group: string, prev: number | null, cur: number | null) => ({ key, label, group, fsli: '', prev, cur, proc: '', procStd: false });
  const d = {
    hasProc: true, groupProc: {} as Record<string, string>,
    rows: [
      R('inv', '재고자산', 'Ⅰ. 유 동 자 산', 100, 5000),
      R('m', '기계장치', G, 4000, 6000), R('ad', '감가상각누계액-기계장치', G, -1000, -3000), R('v', '차량운반구', G, 10, 10),
      R('ar', '매출채권', 'Ⅰ. 유 동 자 산', 10, 20),
      R('x', '잡손실', 'Ⅵ-2. 기타 영업외비용', 3600, 600),
    ],
  };
  const std = [...STD, S('재고자산', 'Material', '공통', '재고실사 입회(E/O)', ['원재료'])];
  const units = bundlesOf(d.rows, std, 1000);
  assert.deepEqual(units.map((u) => [u.bundle, u.onGroup, u.rows.length]), [['재고자산', false, 1], ['유형자산', true, 3]]);
  assert.ok(missingProcs(d, 1000, std).includes('유형자산(묶음)'));
  assert.ok(!missingProcs(d, 1000, std).includes('기계장치'));          // 계정마다 적지 않는다
  const r = fillStdProcs(d, std, '제조업', 1000);
  assert.match(r.data.groupProc![G], /취득·처분 증빙테스트/);
  assert.doesNotMatch(r.data.groupProc![G], /누계액 대사/);
  assert.equal(r.data.rows.find((x) => x.key === 'm')!.proc, '');
  assert.match(r.data.rows.find((x) => x.key === 'inv')!.proc!, /재고실사/);
  assert.match(r.data.rows.find((x) => x.key === 'x')!.proc!, /변동 원인/);   // 예시 없는 계정은 「*」 기본
  assert.deepEqual(missingProcs(r.data, 1000, std), []);
});

import { offIndustry, coveredByGroup } from './gwpProcStd';
test('다른 업종 이월 문구 — 운송 문구는 운송·물류업이 아니면 표준으로 바꾸고, 판관비 분류 줄 절차는 판정 난 계정을 덮지 않는다(더그림·휴식 2026-10-01)', () => {
  const t = '① 결산일 현재 미정산 상태인 운송건에 대항하는 매출에 대한 테스트(CO)';
  assert.equal(offIndustry(t, '콘텐츠·엔터'), true);
  assert.equal(offIndustry(t, '운송·물류업'), false);
  assert.equal(offIndustry('① 금융기관조회서의 발송 및 확인(E/O, A)', '서비스업'), false);
  const d = {
    rows: [
      { key: 's', label: '매출액', fsli: '매출액', group: 'Ⅰ. 매 출 액', prev: 100, cur: 5000, proc: t, procStd: false },
      { key: 'w', label: '직원급여', fsli: '판 매 비 와 관 리 비', group: 'Ⅳ. 판매비와관리비', prev: 100, cur: 5000, proc: '', procStd: false },
      { key: 'q', label: '여비교통비', fsli: '판 매 비 와 관 리 비', group: 'Ⅳ. 판매비와관리비', prev: 1, cur: 2, proc: '', procStd: false },
    ],
    groupProc: { 'Ⅳ. 판매비와관리비': '① 월별 판매비와 관리비 변동 증감 분석 확인(V)' } as Record<string, string>,
  };
  const std = [...STD, S('판매비와관리비', '항상', '공통', '월별 판매비와관리비 변동 분석(V)')];
  assert.equal(coveredByGroup(d.rows[1], d.groupProc), false);
  const r = fillStdProcs(d, std, '콘텐츠·엔터', 1000);
  const by = new Map(r.data.rows.map((x) => [x.key, x]));
  assert.doesNotMatch(by.get('s')!.proc!, /운송/);
  assert.match(by.get('w')!.proc!, /증빙테스트/);                 // 판정 난 판관비 계정은 제 절차
  assert.equal(by.get('q')!.proc, '');                            // 판정 없는 판관비엔 「항상」 안 붙음(공시 계정이 판매비와관리비여도)
});

import { splitProc, generalizeProc, harvestProcs, stdHas } from './gwpProcStd';
test('표준 쌓기 — 문구 나누기·금액 일반화·이미 있는 줄 거르기·다른 회사 2120A 에서 뽑기', () => {
  assert.deepEqual(splitProc('① 금융기관조회서의 발송 및 확인(E/O, A) / ② 사용제한예금 검토'), ['금융기관조회서의 발송 및 확인(E/O, A)', '사용제한예금 검토']);
  assert.deepEqual(splitProc('① 계약사항 확인\n② 우발약정사항검토'), ['계약사항 확인', '우발약정사항검토']);
  assert.equal(generalizeProc('전기 대비 +6.9억원(+1499.7%) 변동 원인 파악'), '전기 대비 {증감액}({증감률}) 변동 원인 파악');
  assert.equal(stdHas(STD, '미수수익', '미수수익 재계산 (A)'), true);
  const h = harvestProcs({
    rows: [
      { label: '보증금', prev: 1, cur: 2, proc: '① 주요 항목(보증금)에 대한 조회확인(E/O, A) / ② 보증금 현재가치평가 수행' },
      { label: '미수수익', prev: 1, cur: 2, proc: '① 미수수익 재계산(A)' },
      { label: '매출액', prev: 1, cur: 2, proc: '① 결산일 현재 미정산 상태인 운송건에 대항하는 매출에 대한 테스트(CO)' },
      { label: '부외부채 테스트', prev: null, cur: null, proc: '① 우발채무' },
    ],
    groupProc: { '(1)  유  형  자  산': '① 취득/처분 내역에 대한 증빙테스트 / ② 감가상각에 대한 검증(A, V)', 'Ⅳ. 판매비와관리비': '① 월별 분석' },
  }, STD, null);
  assert.deepEqual(h.map((x) => x.account), ['유형자산', '유형자산', '보증금', '보증금', '미수수익', '매출액']);
  assert.equal(h.find((x) => x.account === '미수수익')!.exists, true);
  assert.equal(h.find((x) => x.account === '매출액')!.off, true);
});

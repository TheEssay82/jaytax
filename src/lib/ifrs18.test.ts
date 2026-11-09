// K-IFRS 1118 월결산 — 계산 규칙 시험. 숫자는 지어낸 작은 회사다(실제 회사 판단표는 저장소에 넣지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, ifrs18KeyFromPath, line1118, parseSapJournal, suggestTarget, validateConfig, type AcctRule, type Ifrs18Config, type JLine } from './ifrs18';

const A = (gl: string, name: string, l1001: AcctRule['l1001'], kcat: AcctRule['kcat'], extra: Partial<AcctRule> = {}): AcctRule => ({ gl, name, l1001, kcat, ...extra });
const cfg: Ifrs18Config = {
  clientKey: 'demo', clientName: '데모(주)',
  accounts: [
    A('41010101', '매출', '영업수익', '영업'),
    A('51020101', '급여', '영업비용', '영업'),
    A('51030101', '퇴직급여', '영업비용', '영업'),
    A('74010115', '순이자원가-확정급여부채', '영업비용', '재무'),
    A('71020201', '외환차익-외상매출금', '기타수익', '영업', { detail: '외환이익(영업)' }),
    A('71030101', '외화환산이익-예금', '금융수익', '투자', { detail: '외환이익(투자)' }),
    A('71320101', '파생상품자산평가이익', '금융수익', '투자', { ncat: '영업', detail: '파생(영업)', note: '선물환 — 매출채권 위험관리(B72)' }),
    A('72050114', '무형자산 손상차손-암호화폐', '기타비용', '영업', { special: '무형자산손상' }),
    A('72030101', '기타의대손상각비', '금융비용', '영업', { watch: true }),
    A('51120701', '지급수수료-금융-송금수수료', '영업비용', '영업', { watch: true }),
    A('73010103', '이자수익-장기대여금', '금융수익', '투자'),
    A('74010111', '이자비용-단기차입금', '금융비용', '재무'),
    A('81010101', '법인세비용', '법인세비용', '법인세'),
  ],
  bsAttr: { '11040101': '영업', '11100001': '현금', '12010101': '투자', '11050201': '투자', '21020101': '재무', '22020101': '영업', '12070801': '영업' },
  actuarial: [{ key: 'pa', label: '사외적립자산 이자수익', srcGl: '51030101', target: '재무비용', annual: -1200 }],
};
let n = 0;
const L = (docNo: string, gl: string, dr: number, cr: number, extra: Partial<JLine> = {}): JLine =>
  ({ docNo, date: '2026-06-30', gl, glName: gl, dr, cr, memo: `m${++n}`, vendor: '', temp: false, ...extra });

const journal: JLine[] = [
  L('1', '11040101', 10000, 0), L('1', '41010101', 0, 10000),
  L('2', '51020101', 3000, 0), L('2', '11100001', 0, 3000),
  L('3', '51030101', 700, 0), L('3', '22020101', 0, 700),            // 근무원가 + 이자수익(-600) 섞인 퇴직급여는 계리로 분리
  L('4', '74010115', 500, 0), L('4', '22020101', 0, 500),
  L('5', '11040101', 120, 0), L('5', '71020201', 0, 120),
  L('6', '11100001', 300, 0), L('6', '71030101', 0, 300),
  L('7', '11100001', 50, 0), L('7', '71320101', 0, 50),
  L('8', '72050114', 400, 0), L('8', '11100001', 0, 400),
  L('9', '72030101', 900, 0), L('9', '11050201', 0, 900),          // 대여금 손상 — 주의계정, 같은 전표에 대여금(투자)
  L('10', '12010101', 1000, 0), L('10', '51120701', 30, 0), L('10', '11100001', 0, 1030), // 출자 송금수수료
  L('11', '11100001', 80, 0), L('11', '73010103', 0, 80),
  L('12', '74010111', 60, 0), L('12', '11100001', 0, 60),
  L('13', '81010101', 1000, 0), L('13', '11100001', 0, 1000),
  L('14', '51020101', 999, 0, { temp: true }), L('14', '11100001', 0, 999, { temp: true }),  // 임시전표 — 빼야 함
];

test('1118 표시항목 — 범주 × 1001 항목 × 특수구분', () => {
  const by = (gl: string) => line1118(cfg.accounts.find((a) => a.gl === gl)!);
  assert.equal(by('41010101'), '영업수익');
  assert.equal(by('71020201'), '기타영업수익');
  assert.equal(by('71030101'), '투자수익');
  assert.equal(by('71320101'), '기타영업수익');   // 회사 판단(ncat)이 크래프톤 범주를 덮는다
  assert.equal(by('72050114'), '무형자산손상차손');
  assert.equal(by('74010115'), '재무비용');       // 1001 영업비용이어도 재무 → 재무비용
  assert.equal(by('81010101'), '법인세비용');
});

test('손익계산서 — 영업손익 · 당기순이익 불변 · 브릿지', () => {
  const r = compute(journal, cfg, [], 2026, 6);
  // 계리: 연 -1200 × 6/12 = -600 을 퇴직급여(영업비용)에서 빼서 재무비용으로
  assert.equal(r.moves.find((m) => m.kind === '계리')?.amount, -600);
  assert.equal(r.pl1118['영업수익'], 10000);
  assert.equal(r.pl1118['영업비용'], -3000 - 700 - 30 - 600);   // 퇴직급여에서 이자수익(-600)이 빠지면 비용이 600 늘어난다
  assert.equal(r.pl1118['재무비용'], -500 - 60 + 600);
  assert.equal(r.pl1118['영업손익'], 10000 - 4330 + 120 + 50 - 400 - 900);
  assert.equal(r.pl1001['당기순이익'], r.pl1118['당기순손익']);
  assert.equal(r.bridge[r.bridge.length - 1].amount, r.pl1118['영업손익']);
  assert.equal(r.tempCount, 2);
  assert.ok(r.checks.find((c) => c.id === 'ni')!.ok);
  assert.ok(r.checks.find((c) => c.id === 'bridge')!.ok);
});

test('주의계정 — 같은 전표의 투자 · 재무 계정을 찾고, 판단 「조정」은 제안 항목으로 옮긴다', () => {
  const r0 = compute(journal, cfg, [], 2026, 6);
  assert.deepEqual(r0.watch.map((w) => [w.docNo, w.gl, w.cpAttr, w.suggest, w.decision]), [
    ['9', '72030101', '투자', '기타투자비용', '미판단'],
    ['10', '51120701', '투자', '기타투자비용', '미판단'],
  ]);
  assert.equal(r0.checks.find((c) => c.id === 'watch')!.ok, false);
  const r = compute(journal, cfg, [
    { docNo: '9', gl: '72030101', decision: '조정', target: '대여금 손상차손', reason: '종속기업 대여금 손상' },
    { docNo: '10', gl: '51120701', decision: '영업 유지', reason: '경미' },
  ], 2026, 6);
  assert.equal(r.pl1118['대여금 손상차손'], -900);
  assert.equal(r.pl1118['기타영업비용'], 0);        // 대손 900 이 대여금 손상차손으로 옮겨 갔다(무형자산손상은 별도 행)
  assert.equal(r.pl1118['무형자산손상차손'], -400);
  assert.equal(r.pl1001['당기순이익'], r.pl1118['당기순손익']);
  assert.ok(r.checks.find((c) => c.id === 'watch')!.ok);
});

test('미등록 계정 · BS 속성은 확인으로 걸린다', () => {
  const r = compute([...journal, L('20', '72990101', 5, 0), L('20', '19999999', 0, 5)], cfg, [], 2026, 6);
  assert.equal(r.checks.find((c) => c.id === 'reg')!.ok, false);
  assert.deepEqual(r.unregisteredBs, ['19999999']);
});

test('SAP 분개장 — 머리글 이름으로 열을 찾는다(열 순서 무관) · 임시전표 X', () => {
  const rows = [
    ['회사코드', 'G/L 계정명', '전표번호', '대변금액(로컬)', '전기일', 'G/L 계정', '차변금액(로컬)', '라인텍스트', '임시전표구분'],
    ['5500', '외상매출금', '2000000001', 0, new Date('2026-01-31T00:00:00Z'), '11040101', '1,000', '판매', ''],
    ['5500', '매출', '2000000001', 1000, '2026.01.31', '41010101', 0, '판매', 'X'],
    ['', '', '', '', '', '합계', '', '', ''],
  ];
  const p = parseSapJournal(rows);
  assert.equal(p.head, 0);
  assert.equal(p.lines.length, 2);
  assert.deepEqual([p.lines[0].dr, p.lines[0].date, p.lines[1].cr, p.lines[1].temp], [1000, '2026-01-31', 1000, true]);
  assert.equal(p.skipped, 1);
  assert.deepEqual(parseSapJournal([['a', 'b']]).missing.length > 0, true);
});

test('제안 항목 · 판단표 검사', () => {
  assert.equal(suggestTarget(cfg.accounts[4], '재무'), '재무수익');
  assert.equal(suggestTarget(cfg.accounts[1], '투자'), '기타투자비용');
  assert.equal(suggestTarget(cfg.accounts[1], '영업'), null);
  assert.equal(validateConfig(cfg).ok, true);
  assert.equal(validateConfig({ ...cfg, clientKey: 'Bad Key' }).ok, false);
  assert.equal(validateConfig({ ...cfg, accounts: [{ ...cfg.accounts[0], l1001: '이상' }] }).ok, false);
});

test('회사 전용 주소 — /kifrs1118_<회사키>', () => {
  assert.equal(ifrs18KeyFromPath('/kifrs1118_neptune'), 'neptune');
  assert.equal(ifrs18KeyFromPath('/kifrs1118_neptune/'), 'neptune');
  assert.equal(ifrs18KeyFromPath('/kifrs1118_'), null);
  assert.equal(ifrs18KeyFromPath('/kifrs1118_a b'), null);
  assert.equal(ifrs18KeyFromPath('/'), null);
});

test('기간별 — 당월 · 당분기 = 누적에서 잘라 뺀 값', async () => {
  const { computePeriods, monthEnd } = await import('./ifrs18');
  const j2: JLine[] = [
    ...journal.map((l) => ({ ...l, date: '2026-04-15' })),
    L('30', '11040101', 5000, 0, { date: '2026-05-10' }), L('30', '41010101', 0, 5000, { date: '2026-05-10' }),
    L('31', '11040101', 700, 0, { date: '2026-06-20' }), L('31', '41010101', 0, 700, { date: '2026-06-20' }),
  ];
  assert.equal(monthEnd(2026, 2), '2026-02-28');
  const p = computePeriods(j2, cfg, [], 2026, 6);
  assert.equal(p.prevMonthNo, 5); assert.equal(p.prevQuarterNo, 3);
  assert.equal(p.cum.pl1118['영업수익'], 15700);
  assert.equal(p.month.pl1118['영업수익'], 700);
  assert.equal(p.quarter.pl1118['영업수익'], 15700);
  // 계리: 연 -1200 → 당월 -100 이 재무비용(+100)으로
  assert.equal(p.month.pl1118['재무비용'], 100);
  assert.equal(p.prevQuarter.pl1118['재무비용'], 300);   // 1분기 3개월분(분개는 없음)
  for (const k of ['영업손익', '당기순손익']) assert.equal(p.month.pl1118[k] + p.prevMonth.pl1118[k], p.cum.pl1118[k]);
  const p1 = computePeriods(j2, cfg, [], 2026, 1);
  assert.equal(p1.prevMonthNo, 0); assert.equal(p1.month.pl1118['당기순손익'], p1.cum.pl1118['당기순손익']);
});

test('조정전표(권고코드) 반영 — 기표한 만큼 덜 옮기고 결과는 같다 · 코드/계정 이상은 걸린다', async () => {
  const { tagOf, suggestReclassGl } = await import('./ifrs18');
  const cfg2: Ifrs18Config = { ...cfg, accounts: [...cfg.accounts, A('72030199', '대여금손상차손', '금융비용', '투자', { special: '대여금손상' })] };
  const jd = [{ docNo: '9', gl: '72030101', decision: '조정' as const, target: '대여금 손상차손' as const, reason: '대여금 손상' }];
  const before = compute(journal, cfg2, jd, 2026, 6);
  const m0 = before.moves.find((m) => m.kind === '판단')!;
  assert.equal(m0.code, '1118-J-9-72030101'); assert.equal(m0.required, 900); assert.equal(m0.posted, 0);
  assert.equal(m0.reclassGl, '72030199');
  assert.equal(tagOf('KADP 1118-J-9-72030101 재분류'), '1118-J-9-72030101');
  const posted = [...journal,
    L('40', '72030199', 900, 0, { memo: '1118-J-9-72030101 재분류' }), L('40', '72030101', 0, 900, { memo: '1118-J-9-72030101 재분류' }),
    // 계리: 6개월분 -600 을 퇴직급여 → 순이자원가(재무)로 기표
    L('41', '51030101', 600, 0, { memo: '1118-A-pa' }), L('41', '74010115', 0, 600, { memo: '1118-A-pa' }),
  ];
  const after = compute(posted, cfg2, jd, 2026, 6);
  for (const m of after.moves) assert.equal(m.amount, 0, m.code);
  for (const k of ['영업손익', '대여금 손상차손', '재무비용', '당기순손익']) assert.equal(after.pl1118[k], before.pl1118[k], k);
  assert.ok(after.checks.find((c) => c.id === 'tag')!.ok);
  const bad = compute([...posted, L('42', '51020101', 10, 0, { memo: '1118-X-zz' }), L('42', '11100001', 0, 10)], cfg2, jd, 2026, 6);
  assert.equal(bad.tagIssues[0].why, '미등록코드');
  assert.equal(suggestReclassGl(cfg2, '51120701', '기타투자비용'), '');
});

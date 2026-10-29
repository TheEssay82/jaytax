import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adjCarryForward, groupOf, normName, overdueOneOff, partyRows, sumByGroup } from './revenueForecast';
import type { RevenueFact } from './revenueStatsApi';

const f = (p: Partial<RevenueFact>): RevenueFact => ({
  id: Math.random().toString(36).slice(2), ym: '2026-03', fy: 2025, team: 'taxteam', cpa: '', shares: [],
  erpAccount: '', company: '', place: '', typeTop: '', typeFull: '', billingCycle: '', phase: '', status: '',
  supply: 0, origin: '실적', kind: '기타', bizType: '', ...p,
});

describe('조정수수료 전년 동액(adjCarryForward)', () => {
  const prev = [
    f({ company: '㈜가나', entityId: 'a', kind: '세무조정', supply: 3_000_000, ym: '2026-03' }),
    f({ company: '다라', entityId: 'b', kind: '세무조정', supply: 1_000_000, ym: '2026-05' }),
    f({ company: '마바(주)', kind: '세무조정', supply: 500_000, ym: '2025-08' }),
    f({ company: '㈜가나', entityId: 'a', kind: '기장료', supply: 200_000, ym: '2026-03' }),
    f({ company: '폐업사', entityId: 'z', kind: '세무조정', supply: 900_000, ym: '2026-03' }),
  ];
  it('이번 해 계약이 있으면 넣지 않고, 없으면 1년 뒤 같은 달에 넣는다', () => {
    const cur = [f({ company: '㈜가나', entityId: 'a', kind: '세무조정', supply: 3_500_000, origin: '예상', fy: 2026, ym: '2027-03' })];
    const out = adjCarryForward(prev, cur, '2026-10', new Set(['id:z']));
    assert.deepEqual(out.map((x) => [x.company, x.ym, x.supply, x.status]), [
      ['다라', '2027-05', 1_000_000, '전년동액'],
      ['마바(주)', '2026-10', 500_000, '전년동액'],   // 2026-08 은 지났으므로 이번 달로
    ]);
    assert.equal(out.every((x) => x.fy === 2026 && x.origin === '예상'), true);
  });
  it('계약 없는 청구(이름만)도 같은 거래처로 알아본다', () => {
    const cur = [f({ company: '마바', kind: '세무조정', supply: 1, origin: '청구', fy: 2026, ym: '2026-09' })];
    const out = adjCarryForward(prev, cur, '2026-10', new Set(['id:z']));
    assert.deepEqual(out.map((x) => x.company), ['㈜가나', '다라']);
  });
});

describe('칸 나누기', () => {
  it('감사팀은 감사 · 용역 · 세무조정', () => {
    assert.equal(groupOf(f({ team: '감사team', erpAccount: '회계감사수입' })), '감사');
    assert.equal(groupOf(f({ team: '감사team', erpAccount: '기타용역수입' })), '용역');
    assert.equal(groupOf(f({ team: '감사team', kind: '세무조정' })), '세무조정');
    assert.equal(groupOf(f({ team: '감사team', erpAccount: '감사', typeTop: '감사' })), '감사');
  });
  it('기장팀은 기장료 · 조정수수료 · 자문·기타 — 해마다 다른 계정 이름을 같은 칸으로', () => {
    assert.equal(groupOf(f({ kind: '기장료' })), '기장료');
    assert.equal(groupOf(f({ kind: '세무조정' })), '조정수수료');
    assert.equal(groupOf(f({ kind: '기타' })), '자문·기타');
    assert.equal(groupOf(f({ kind: '기장료', erpAccount: '컨설팅' })), '자문·기타');
    assert.equal(groupOf(f({ kind: '기타', erpAccount: '기타용역수입' })), '자문·기타');
    assert.equal(groupOf(f({ kind: '기장료', erpAccount: '원천' })), '기장료');
  });
  it('sumByGroup 은 그 팀만 더한다', () => {
    const s = sumByGroup([f({ kind: '기장료', supply: 10 }), f({ kind: '세무조정', supply: 5 }), f({ team: '감사team', supply: 99 })], 'taxteam');
    assert.deepEqual(s, { 기장료: 10, 조정수수료: 5, '자문·기타': 0 });
  });
  it('normName 은 법인 표기를 뗀다', () => {
    assert.equal(normName('㈜가 나'), normName('가나(주)'));
    assert.equal(normName('오큘러스제1호(합)'), '오큘러스제1호');
  });
});

describe('거래처별 앞 해 · 이번 해(partyRows)', () => {
  it('id 없는 옛 실적과 id 있는 예상을 이름으로 한 줄에 모은다', () => {
    const prev = [f({ company: '라운드투', kind: '세무조정', supply: 2_000_000 })];
    const cur = [
      f({ company: '라운드투', entityId: 'r', kind: '세무조정', supply: 2_000_000, status: '전년동액', origin: '예상', fy: 2026 }),
      f({ company: '라운드투', entityId: 'r', kind: '기장료', supply: 100_000, origin: '청구', fy: 2026 }),
    ];
    const rows = partyRows(prev, cur, 'taxteam');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].prev.조정수수료, 2_000_000);
    assert.deepEqual(rows[0].cur, { 기장료: 100_000, 조정수수료: 2_000_000, '자문·기타': 0 });
    assert.equal(rows[0].adjSource, '전년동액');
  });
});

describe('지난 달 미청구 연 · 건 계약(overdueOneOff)', () => {
  it('청구 안 된 연 계약만 이번 달로 민다 — 청구된 것 · 월 계약은 그대로', () => {
    const sched = [
      f({ company: '에이수스', entityId: 'a', kind: '세무조정', billingCycle: '연', supply: 6_000_000, ym: '2026-07', origin: '예상' }),
      f({ company: '연건', entityId: 'b', kind: '세무조정', billingCycle: '건', supply: 300_000, ym: '2026-07', origin: '예상' }),
      f({ company: '기장사', entityId: 'c', kind: '기장료', billingCycle: '월', supply: 200_000, ym: '2026-08', origin: '예상' }),
    ];
    const actual = [f({ company: '연건', entityId: 'b', kind: '세무조정', supply: 300_000, ym: '2026-07', origin: '청구' })];
    const out = overdueOneOff(sched, actual, '2026-10');
    assert.deepEqual(out.map((x) => [x.company, x.ym, x.status]), [['에이수스', '2026-10', '미청구 이월']]);
  });
});

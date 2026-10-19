// 팀결산 경비 귀속 제안 — 2026-10-19 송현주 FY2026 실제 판단을 정답으로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest, summarize, personalOf, descKey, type ClientRef } from './expenseSuggest';

const clients: ClientRef[] = [
  { name: '㈜레이벡스', keys: ['레이벡스'], taxOwners: ['정우철'], auditOwners: [] },
  { name: '㈜에이투지엔터테인먼트', keys: ['에이투지엔터테인먼트', '에이투지'], taxOwners: ['정우철'], auditOwners: [] },
  { name: '㈜메리크리스마스', keys: ['메리크리스마스'], taxOwners: ['정우철'], auditOwners: [] },
  { name: '㈜넵튠', keys: ['넵튠'], taxOwners: [], auditOwners: ['정우철'] },
  { name: '㈜오톰', keys: ['오톰'], taxOwners: [], auditOwners: ['정우철'] },
];
const L = (description: string, account: string, supply = 10000, vendor = '') => ({ description, account, vendor, supply });

test('정우철 기장·세무조정 거래처 접대는 개인으로 제안한다 — 레이벡스·에이투지·메리크리스마스', () => {
  for (const d of ['(주)레이벡스 접대비', '에이투지 접대비', '(주)메리크리스마스 접대비']) {
    const s = suggest(L(d, '기업업무추진비'), '정우철', clients, []);
    assert.equal(s.work, 0, d);
    assert.ok(s.client?.startsWith('㈜'), d);
  }
});

test('골프·주말 근무 식대는 제안하지 않는다(적요만으로 판단 금지)', () => {
  assert.equal(suggest(L('거래처 접대((주)넵튠)', '기업업무추진비', 391000, '화산개발(주)화산C.C'), '정우철', clients, []).work, null);
  assert.equal(suggest(L('주말 근무 식대', '복리후생비'), '정우철', clients, []).work, null);
});

test('감사·용역 거래처 방문 교통비는 그 거래처 업무로', () => {
  const s = suggest(L('(주)오톰 방문 기차표(6/11)', '여비교통비', 40100), '정우철', clients, []);
  assert.deepEqual([s.client, s.work], ['㈜오톰', 40100]);
});

test('인지세·모니터·오피스는 기장 업무, 한공회 교육은 개인', () => {
  assert.deepEqual([suggest(L('인지세 납부', '세금과공과금', 20000), '정우철', clients, []).client, suggest(L('인지세 납부', '세금과공과금', 20000), '정우철', clients, []).work], ['기장', 20000]);
  assert.equal(suggest(L('사무실 보조 모니터 구매', '소모품비'), '정우철', clients, []).client, '기장');
  const e = suggest(L('한공회 온라인 교육', '교육훈련비', 8000), '정우철', clients, []);
  assert.deepEqual([e.client, e.work], ['기타', 0]);
});

test('이전에 확정한 같은 내역이 있으면 그것을 먼저 따른다(날짜·숫자는 무시)', () => {
  const prior = [{ description: '야근 식대(기장팀) 3/18', account: '복리후생비', client: '기장', workRatio: 1 }];
  const s = suggest(L('야근 식대(기장팀) 4/22', '복리후생비', 50000), '정우철', clients, prior);
  assert.deepEqual([s.client, s.work], ['기장', 50000]);
  assert.match(s.reason, /이전에 확정/);
  assert.equal(descKey('야근 식대(기장팀) 3/18'), descKey('야근 식대(기장팀) 4/22'));
});

test('집계 — 기장 업무 / 3인 공동 / 개인 / 나눈 몫, 송현주 FY2026 숫자', () => {
  const rows = [
    { client: '기장', supply: 615798, work_amount: 615798, split_kjs: 0, split_jhg: 0, status: '확정' },
    { client: '㈜넵튠', supply: 391000, work_amount: 0, split_kjs: 0, split_jhg: 0, status: '확정' },
    { client: '㈜레이벡스', supply: 179100, work_amount: 0, split_kjs: 0, split_jhg: 0, status: '확정' },
    { client: '기타', supply: 20000, work_amount: 0, split_kjs: 0, split_jhg: 0, status: '제안' },
  ];
  const s = summarize(rows);
  assert.deepEqual([s.bookkeeping, s.team, s.personal, s.supply], [615798, 0, 590100, 1205898]);
  assert.deepEqual([s.confirmed, s.suggested], [3, 1]);
  assert.equal(personalOf({ supply: 300000, work_amount: 100000, split_kjs: 50000, split_jhg: 50000 }), 100000);
});

test('거래처 경조사는 거래처 이름이 있어도 개인, 거래처 미팅 주유비는 업무', () => {
  const a = suggest(L('거래처 축의금((주)오톰_김과장)', '기업업무추진비', 100000), '정우철', clients, []);
  assert.deepEqual([a.client, a.work], ['㈜오톰', 0]);
  const b = suggest(L('(주)오톰 미팅 관련 주유비', '차량유지비', 50000), '정우철', clients, []);
  assert.deepEqual([b.client, b.work], ['㈜오톰', 50000]);
});

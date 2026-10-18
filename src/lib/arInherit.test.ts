// 미수금대장 새 달이 지난달 결정을 이어받는가 — 2026-09 분에서 연결 19줄·제외 15줄이 풀려 있던 일.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inheritPrior, type PriorArLink } from './arInherit';
import type { ArItem } from './arLedgerApi';

const row = (clientName: string, entityId: string | null = null, placeId: string | null = null): ArItem => ({
  ym: '2026-09', team: 'taxteam', invoiceNo: '26-0925-0001', issuedDate: '2026-09-25', acct: '외상매출금',
  clientName, billed: 0, opening: 0, paid: 0, writeoff: 0, balance: 0,
  contractNo: '', phase: '', kind: '', cpa: '', entityId, placeId,
});
const p = (ym: string, clientName: string, entityId: string | null, placeId: string | null, excluded = false): PriorArLink =>
  ({ ym, clientName, entityId, placeId, excluded });

test('상호로 못 붙은 줄은 이전 달에 손으로 붙인 거래처·사업장을 받는다', () => {
  const r = inheritPrior([row('김효주 프로골퍼')], [p('2026-08', '김효주 프로골퍼', 'E1', 'P1')]);
  assert.equal(r.linked, 1);
  assert.equal(r.rows[0].entityId, 'E1');
  assert.equal(r.rows[0].placeId, 'P1');
});

test('이전 달에 접어 둔 다른 회계사 건은 이번에도 접힌다', () => {
  const r = inheritPrior([row('(주)케이엑스하이텍')], [p('2026-08', '(주)케이엑스하이텍', null, null, true)]);
  assert.equal(r.excluded, 1);
  assert.equal(r.rows[0].excluded, true);
});

test('가장 최근 달의 결정을 따른다 — 7월에 접었다가 8월에 되돌려 붙였으면 붙인다', () => {
  const r = inheritPrior([row('알트')], [p('2026-07', '알트', null, null, true), p('2026-08', '알트', 'E2', 'P2')]);
  assert.equal(r.excluded, 0);
  assert.equal(r.rows[0].entityId, 'E2');
});

test('상호로 이미 붙은 줄은 그대로 — 사업장만 비었으면 같은 거래처일 때 사업장을 채운다', () => {
  const r = inheritPrior(
    [row('시파사', 'E3', null), row('윤강', 'E4', 'P4')],
    [p('2026-08', '시파사', 'E3', 'P3'), p('2026-08', '윤강', 'E9', 'P9')],
  );
  assert.equal(r.rows[0].placeId, 'P3');
  assert.equal(r.rows[1].entityId, 'E4', '상호 매칭이 이전 달 연결보다 앞선다');
  assert.equal(r.rows[1].placeId, 'P4');
  assert.equal(r.linked, 1);
});

test('이전 달에 없던 이름은 손대지 않는다', () => {
  const r = inheritPrior([row('주식회사 메쥬')], [p('2026-08', '다른곳', 'E1', 'P1')]);
  assert.deepEqual([r.linked, r.excluded], [0, 0]);
  assert.equal(r.rows[0].entityId, null);
  assert.equal(r.rows[0].excluded, undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateKey, takenKeys, isCandidate, pickDocEmail, pickPlace, erpAccountOf,
} from './invoiceCandidates.ts';

const req = (status: string, contractId: string, installmentId: string | null) =>
  ({ status, contractId, installmentId });

// ── 이미 올라간 건 가리기 ───────────────────────────────────
test('취소된 요청은 세지 않는다 — 취소한 뒤에는 다시 올릴 수 있어야 한다', () => {
  const taken = takenKeys([req('취소', 'c1', null)]);
  assert.equal(taken.size, 0);
  assert.equal(isCandidate(candidateKey('c1', null), 100, taken), true);
});

test('요청·발행완료·수정발행은 이미 올라간 것으로 본다', () => {
  for (const s of ['요청', '발행완료', '수정발행']) {
    const taken = takenKeys([req(s, 'c1', null)]);
    assert.equal(isCandidate(candidateKey('c1', null), 100, taken), false, s);
  }
});

test('같은 계약이라도 분할회차가 다르면 다른 건이다', () => {
  const taken = takenKeys([req('요청', 'c1', 'i1')]);
  assert.equal(isCandidate(candidateKey('c1', 'i1'), 100, taken), false);
  assert.equal(isCandidate(candidateKey('c1', 'i2'), 100, taken), true);
});

test('분할회차가 없는 건(null)과 있는 건은 섞이지 않는다', () => {
  assert.notEqual(candidateKey('c1', null), candidateKey('c1', 'i1'));
  assert.equal(candidateKey('c1', null), candidateKey('c1', undefined));
});

test('0원·음수는 후보가 아니다 — 종속계약(청구금액 0)이 여기 해당한다', () => {
  const taken = new Set<string>();
  assert.equal(isCandidate('k', 0, taken), false);
  assert.equal(isCandidate('k', -1, taken), false);
  assert.equal(isCandidate('k', 1, taken), true);
});

// ── 보낼 주소 고르기 ────────────────────────────────────────
const c = (placeId: string | null, email: string, isPrimary = false, active = true) =>
  ({ placeId, email, isPrimary, active });

test('접어 둔 담당자에게는 보내지 않는다 — 이직·퇴사한 사람이다', () => {
  assert.equal(pickDocEmail([c('p1', 'gone@x.com', true, false)], 'p1'), '');
});

test('그 사업장의 대표연락처가 가장 먼저', () => {
  const list = [c('p1', 'other@x.com'), c('p1', 'main@x.com', true), c(null, 'top@x.com', true)];
  assert.equal(pickDocEmail(list, 'p1'), 'main@x.com');
});

test('그 사업장에 대표가 없으면 그 사업장의 아무나', () => {
  assert.equal(pickDocEmail([c('p1', 'any@x.com'), c(null, 'top@x.com', true)], 'p1'), 'any@x.com');
});

test('사업장에 아무도 없으면 거래처 대표연락처로', () => {
  assert.equal(pickDocEmail([c('p2', 'other@x.com'), c('p2', 'top@x.com', true)], 'p1'), 'top@x.com');
});

test('빈 이메일은 없는 것으로 본다', () => {
  assert.equal(pickDocEmail([c('p1', '   ', true), c('p1', 'real@x.com')], 'p1'), 'real@x.com');
});

test('아무도 없으면 빈 문자열 — 화면이 「비어 있으면 넘길 수 없습니다」로 막는다', () => {
  assert.equal(pickDocEmail([], 'p1'), '');
});

// ── 사업장 고르기 ──────────────────────────────────────────
const p = (id: string, placeName: string, isHeadquarters = false) => ({ id, placeName, isHeadquarters });

test('계약에 적힌 사업장이 먼저', () => {
  assert.equal(pickPlace([p('a', '본사', true), p('b', '지점')], 'b')?.id, 'b');
});

test('계약에 사업장이 없으면 본사로 — 실제로 139건이 그렇다', () => {
  assert.equal(pickPlace([p('a', '지점'), p('b', '본사', true)], null)?.id, 'b');
});

test('본사도 없으면 첫 곳', () => {
  assert.equal(pickPlace([p('a', '어딘가')], null)?.id, 'a');
});

test('사업장이 하나도 없으면 undefined', () => {
  assert.equal(pickPlace([], null), undefined);
});

// ── ERP 매출계정 ───────────────────────────────────────────
test('부가세 신고대리·원천세는 세무조정이 아니라 기장이다', () => {
  assert.equal(erpAccountOf('TAX.BOOK'), '기장대리수입');
  assert.equal(erpAccountOf('TAX.FILING.VAT'), '기장대리수입');
  assert.equal(erpAccountOf('TAX.FILING.WHT'), '기장대리수입');
});

test('그 밖의 신고대리는 세무조정수입', () => {
  assert.equal(erpAccountOf('TAX.FILING.CORP'), '세무조정수입');
  assert.equal(erpAccountOf('TAX.FILING.INCOME'), '세무조정수입');
  assert.equal(erpAccountOf('AUD.SVC.FILING.X'), '세무조정수입');
});

test('회계감사와 그 밖의 용역', () => {
  assert.equal(erpAccountOf('AUD.AUDIT'), '회계감사수입');
  assert.equal(erpAccountOf('AUD.SVC.VALUE'), '기타용역수입');
  assert.equal(erpAccountOf(''), '기타용역수입');
});

// ── 감사팀 제안(분할회차 알림) ──────────────────────────────
import { shouldPropose, byUrgency } from './invoiceCandidates.ts';

const inst = (dueDate: string | null, billedAt: string | null = null) => ({ dueDate, billedAt });

test('청구기한이 없으면 알리지 않는다 — 언제인지 모르는 것을 재촉할 수 없다', () => {
  assert.equal(shouldPropose(inst(null), 999, 30), false);
});

test('이미 청구한 회차는 알리지 않는다', () => {
  assert.equal(shouldPropose(inst('2026-08-31', '2026-08-31'), 5, 30), false);
});

test('기한이 지났으면 알린다', () => {
  assert.equal(shouldPropose(inst('2026-08-31'), 4, 0), true);
  assert.equal(shouldPropose(inst('2026-08-31'), 0, 0), true);   // 오늘이 기한
});

test('withinDays 만큼 미리 알린다 — 그 밖은 아직 멀었다', () => {
  assert.equal(shouldPropose(inst('2026-10-01'), -30, 30), true);   // 딱 30일 전
  assert.equal(shouldPropose(inst('2026-10-01'), -31, 30), false);  // 31일 전은 아직
  assert.equal(shouldPropose(inst('2026-10-01'), -1, 0), false);    // 미리 알림 끄면 기한 전은 안 나온다
});

test('밀린 순서가 곧 급한 순서 — 오래 지난 것부터, 같으면 이름순', () => {
  const rows = [
    { overdueDays: 3, companyName: '나' },
    { overdueDays: 10, companyName: '다' },
    { overdueDays: 3, companyName: '가' },
  ];
  assert.deepEqual([...rows].sort(byUrgency).map((r) => r.companyName), ['다', '가', '나']);
});

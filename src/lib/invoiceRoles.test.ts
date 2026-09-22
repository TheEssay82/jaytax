// 감사팀 발행요청 화면의 첫 탭 규칙 — 발행 담당만 「발행 처리」로 연다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultAuditInvoicePane, FINAL_APPROVER } from './invoiceRoles';

test('발행 담당(김민섭)은 발행 처리 탭으로 연다', () => {
  assert.equal(FINAL_APPROVER, '김민섭');
  assert.equal(defaultAuditInvoicePane('김민섭'), 'issue');
});

test('그 밖의 사람은 요청 탭 — 회계사가 올리는 자리', () => {
  for (const n of ['정우철', '송현주', '조현규', '정남지', '김동주', '테스트-팀장']) {
    assert.equal(defaultAuditInvoicePane(n), 'request');
  }
});

test('이름이 아직 안 온 동안에는 요청 탭 — 화면이 뒤에 한 번 바로잡는다', () => {
  assert.equal(defaultAuditInvoicePane(''), 'request');
});

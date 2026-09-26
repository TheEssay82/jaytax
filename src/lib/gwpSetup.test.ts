// 일반조서 당기 세팅 규칙 — 조서 기준과 회계기준을 가르고, 파트너·작성자 기본값을 정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fsBasisOf, basisMismatch, authorFromCpa, proposeSetup, rollBlockedBy, DEFAULT_PARTNER } from './gwpSetup';

test('조서 기준 → 재무제표 회계기준: 일반·소규모는 둘 다 일반기업회계기준', () => {
  assert.equal(fsBasisOf('K-IFRS'), 'K-IFRS');
  assert.equal(fsBasisOf('일반기업회계기준'), '일반기업회계기준');
  assert.equal(fsBasisOf('소규모감사기준'), '일반기업회계기준');
});

test('어긋남 — 명진처럼 재무제표 일반기업 + 조서 소규모는 정상, K-IFRS 와 섞이면 경고', () => {
  assert.equal(basisMismatch('소규모감사기준', '일반기업회계기준'), false);
  assert.equal(basisMismatch('K-IFRS', '일반기업회계기준'), true);
  assert.equal(basisMismatch('일반기업회계기준', 'K-IFRS'), true);
});

test('지정감사의 「법인(지정)」은 작성자가 될 수 없다', () => {
  assert.equal(authorFromCpa('정우철'), '정우철');
  assert.equal(authorFromCpa(' 김준성 '), '김준성');
  assert.equal(authorFromCpa('법인(지정)'), null);
  assert.equal(authorFromCpa(''), null);
  assert.equal(authorFromCpa(null), null);
});

test('전기 세팅이 있으면 그 기준·파트너, 작성자는 계약이 우선', () => {
  const p = proposeSetup({ prior: { auditBasis: '소규모감사기준', partner: '조현규' }, fsBasis: '일반기업회계기준', contractCpa: '김준성' });
  assert.deepEqual(p, { auditBasis: '소규모감사기준', fromPrior: true, partner: '조현규', author: '김준성' });
});

test('전기 세팅이 없으면 — K-IFRS 재무제표만 기준을 정할 수 있고, 일반기업은 일반/소규모를 사람에게 묻는다', () => {
  assert.equal(proposeSetup({ fsBasis: 'K-IFRS' }).auditBasis, 'K-IFRS');
  const p = proposeSetup({ fsBasis: '일반기업회계기준', contractCpa: '정우철' });
  assert.equal(p.auditBasis, null);
  assert.equal(p.fromPrior, false);
  assert.equal(p.partner, DEFAULT_PARTNER);
  assert.equal(p.author, '정우철');
});

test('기준이 바뀐 해는 1단계 이월을 막는다 — 전기를 모르면 막지 않는다', () => {
  assert.equal(rollBlockedBy('소규모감사기준', '소규모감사기준'), null);
  assert.equal(rollBlockedBy(null, '일반기업회계기준'), null);
  assert.match(rollBlockedBy('일반기업회계기준', '소규모감사기준') ?? '', /기준이 바뀐 해/);
});

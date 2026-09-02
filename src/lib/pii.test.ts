// 개인정보 마스킹 — 국외이전 전에 지켜야 하는 선이라 경계를 하나씩 못박는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskPii, unmaskPii, findResidentNos, summarizeHits } from './pii';

test('주민등록번호를 지우고 되돌린다', () => {
  const r = maskPii('의뢰인 주민번호는 850312-1234567 입니다.');
  assert.ok(!r.masked.includes('850312'), r.masked);
  assert.equal(r.hits[0].kind, '주민번호');
  assert.equal(unmaskPii(r.masked, r.map), '의뢰인 주민번호는 850312-1234567 입니다.');
});

test('하이픈 없는 주민번호도 잡는다', () => {
  const r = maskPii('8503121234567 로 신고했습니다');
  assert.ok(!r.masked.includes('8503121234567'), r.masked);
});

test('법인등록번호는 주민번호와 갈라서 본다 — 앞 6자리가 날짜가 아니다', () => {
  const r = maskPii('법인등록번호 110111-1234567 입니다');   // 11월 11일이라 날짜로 읽힌다
  assert.equal(r.hits[0].kind, '주민번호');
  const r2 = maskPii('법인등록번호 110199-1234567 입니다');  // 99일 — 날짜가 아니다
  assert.equal(r2.hits[0].kind, '법인등록번호');
});

test('사업자등록번호·연락처·이메일을 지운다', () => {
  const r = maskPii('123-45-67890 / 010-1234-5678 / a.b@corp.co.kr');
  const kinds = r.hits.map((h) => h.kind).sort();
  assert.deepEqual(kinds, ['사업자번호', '연락처', '이메일'].sort());
  assert.ok(!r.masked.includes('67890') && !r.masked.includes('5678') && !r.masked.includes('@corp'));
});

test('금액은 지우지 않는다 — 계좌는 은행명이 붙은 것만 본다', () => {
  const r = maskPii('공급가액 5,000,000원 / 부가세 500,000원');
  assert.equal(r.hits.length, 0, JSON.stringify(r.hits));
  const bank = maskPii('국민은행 123456-01-123456 로 입금');
  assert.equal(bank.hits[0].kind, '계좌번호');
});

test('주소를 지운다', () => {
  const r = maskPii('서울특별시 강남구 테헤란로 123 4층 으로 보내주세요');
  assert.equal(r.hits[0].kind, '주소');
  assert.ok(!r.masked.includes('테헤란로'), r.masked);
});

test('성명은 거래처 명부로 잡는다 — 같은 사람은 같은 자리표', () => {
  const r = maskPii('정우철 대표께서 문의하셨고, 정우철 대표 명의입니다.', ['정우철']);
  assert.ok(!r.masked.includes('정우철'), r.masked);
  assert.equal(r.hits.filter((h) => h.kind === '인명').length, 1);   // 두 번 나와도 한 자리표
  assert.equal(unmaskPii(r.masked, r.map), '정우철 대표께서 문의하셨고, 정우철 대표 명의입니다.');
});

test('이름은 긴 것부터 지운다', () => {
  const r = maskPii('김민섭 대리와 김민 사원', ['김민', '김민섭']);
  assert.ok(!r.masked.includes('김민섭') && !r.masked.includes('김민'), r.masked);
  assert.equal(unmaskPii(r.masked, r.map), '김민섭 대리와 김민 사원');
});

test('되돌릴 때 {인명10} 이 {인명1} 로 잘리지 않는다', () => {
  const names = Array.from({ length: 12 }, (_, i) => `사람${String.fromCharCode(97 + i)}`);
  const src = names.join(' 그리고 ');
  const r = maskPii(src, names);
  assert.equal(unmaskPii(r.masked, r.map), src);
});

test('마스킹된 본문에는 주민번호가 남지 않는다', () => {
  const r = maskPii('850312-1234567 과 991231-2345678 두 건');
  assert.deepEqual(findResidentNos(r.masked), []);
  assert.equal(findResidentNos('850312-1234567').length, 1);
});

test('가린 내용을 한 줄로 요약한다', () => {
  const r = maskPii('010-1111-2222 / 010-3333-4444 / 850312-1234567');
  assert.equal(summarizeHits(r.hits), '주민번호 1 · 연락처 2');
});

test('가릴 것이 없으면 원문 그대로다', () => {
  const src = '접대비 손금산입 한도를 알려주세요.';
  const r = maskPii(src, ['정우철']);
  assert.equal(r.masked, src);
  assert.equal(r.hits.length, 0);
  assert.equal(summarizeHits(r.hits), '');
});

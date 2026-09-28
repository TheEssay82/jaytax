// 2301 위험별 표준 문구 — 위험 문구로 종류 찾기, 판단(Y/N)에 맞는 예시, 기준서 이름 자리.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOfRisk, phrasesFor, fillPhrase, RISK_KINDS } from './gwp2301Phrases';

test('종류 — 알티스트 2301 다섯 줄', () => {
  assert.equal(kindOfRisk('부정으로 인한 전체재무제표 왜곡표시위험')?.key, 'fraud');
  assert.equal(kindOfRisk('회사의 계속기업으로서의 존속가능성에 관한 의문이 제기되는 경우')?.key, 'going');
  assert.equal(kindOfRisk('특수관계자 거래가 적절하게 회계처리 및 공시되지 않을 위험')?.key, 'related');
  assert.equal(kindOfRisk('법률과 규정의 미준수 사례가 존재할 위험')?.key, 'law');
  assert.equal(kindOfRisk('경영진이 수기분개, 기말조정 … 과대계상할 위험')?.key, 'fraud');
  assert.equal(kindOfRisk('기타사항'), null);
});

test('예시 — 판단에 맞는 것, 판단 전이면 모두', () => {
  const g = '계속기업 존속가능성';
  assert.deepEqual(phrasesFor(g, 'N').map((p) => p.sig), ['N']);
  assert.deepEqual(phrasesFor(g, 'Y').map((p) => p.sig), ['Y']);
  assert.equal(phrasesFor(g, '').length, 2);
  assert.equal(phrasesFor('기타사항', 'Y').length, 0);
  for (const k of RISK_KINDS) for (const p of k.examples) assert.ok(p.control && p.response && p.from, `${k.key}/${p.label}`);
});

test('기준서 이름 — 일반은 제16장, K-IFRS 는 제1024호', () => {
  const r = phrasesFor('특수관계자 거래', 'Y')[0].response;
  assert.match(fillPhrase(r, '일반기업회계기준'), /일반기업회계기준 제16장에 따른/);
  assert.match(fillPhrase(r, 'K-IFRS'), /기업회계기준서 제1024호에 따른/);
});

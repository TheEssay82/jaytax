import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAXONOMY, findNode, leafOf, pathLabel, typeMnemonic, contractTypeOptions } from './salesContractTaxonomy';

// 감사팀 용역 개편(2026-11-15) — 「컨설팅」을 회계자문 · 내부회계 · 실사·확인으로
test('감사팀 용역은 신고 · 평가 · 회계자문 · 내부회계 · 실사·확인', () => {
  const svc = TAXONOMY['감사team'].find((n) => n.code === 'AUD.SVC')!;
  assert.deepEqual(svc.children!.map((n) => n.label), ['신고(세무조정포함)', '평가', '회계자문', '내부회계', '실사·확인']);
});

test('옛 code 는 그대로 살아 있고 자리만 옮겼다(저장된 계약이 끊기지 않는다)', () => {
  for (const c of ['AUD.SVC.CON.IFRS', 'AUD.SVC.CON.ICFR_BUILD', 'AUD.SVC.CON.ICFR_PA', 'AUD.SVC.CON.ADVISORY', 'AUD.SVC.CON.ETC']) assert.ok(leafOf(c), c);
  assert.equal(pathLabel('AUD.SVC.CON.ICFR_PA'), '용역 › 내부회계 › 운영지원(PA)');
  assert.equal(pathLabel('AUD.SVC.CON.STD'), '용역 › 회계자문 › K-IFRS 기준서 적용검토');
  assert.equal(pathLabel('AUD.SVC.DUE.AUP'), '용역 › 실사·확인 › 업무감사(합의된 절차)');
});

test('용역 leaf 는 기본 청구주기가 「건」(한 번에 청구)', () => {
  for (const o of contractTypeOptions().filter((x) => x.code.startsWith('AUD.SVC.'))) {
    assert.equal(findNode(o.code)!.node.defaultCycle, '건', o.code);
  }
});

test('매출계약코드 니모닉은 팀 안에서 겹치지 않는다', () => {
  for (const pre of ['AUD.', 'TAX.']) {
    const leaves = contractTypeOptions().filter((o) => o.code.startsWith(pre)).map((o) => typeMnemonic(o.code));
    assert.equal(new Set(leaves).size, leaves.length, pre);
  }
});

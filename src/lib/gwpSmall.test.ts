// 소규모 짝 정리 — 「번호(소규모)」 숨김 + 일반 「번호」 보임이면 소규모 쪽을 쓴다(명진 FY25 모양).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSmall } from './gwpSmall';

const MJ = [
  { name: '2301' }, { name: '2302', hidden: true },
  { name: '2511(소규모)', hidden: true }, { name: '2520(소규모)', hidden: true }, { name: '2530(소규모)', hidden: true },
  { name: '2531(소규모)', hidden: true }, { name: '2531A(소규모)', hidden: true }, { name: '2532(소규모)', hidden: true },
  { name: '2511' }, { name: '2512' }, { name: '2513' }, { name: '2520' }, { name: '2530' },
  { name: '2700A-1(적용지침)' }, { name: '2700A-1(소규모)', hidden: true },
];

test('짝 — 2511·2520·2530 은 소규모 쪽으로, 딸림 2512·2513 은 숨김, 양쪽 안 쓰던 2531·2532 는 그대로', () => {
  const p = planSmall(MJ, new Set(['2301', '2511', '2520', '2530', '2531', '2531A', '2532', '2700A-1']));
  assert.deepEqual(p.pairs.map((x) => [x.code, x.small, x.plain]), [['2511', '2511(소규모)', '2511'], ['2520', '2520(소규모)', '2520'], ['2530', '2530(소규모)', '2530']]);
  assert.deepEqual(p.hide, ['2512', '2513']);
});

test('꼬리 붙은 시트(2700A-1(적용지침))는 일반 짝으로 보지 않는다', () => {
  const p = planSmall(MJ);
  assert.ok(!p.pairs.some((x) => x.code === '2700A-1'));
});

test('올해 양식에 있는 번호는 딸림으로 숨기지 않는다', () => {
  const p = planSmall(MJ, new Set(['2512']));
  assert.deepEqual(p.hide, ['2513']);
});

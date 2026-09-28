// 소규모 짝 정리 — 「번호(소규모)」 숨김 + 일반 「번호」 보임이면 소규모 쪽을 쓴다(명진 FY25 모양).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSmall, planLarge, planTidy } from './gwpSmall';

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

test('소규모 → 일반 — 보이는 「번호(소규모)」만, 일반 시트가 있으면 보이기, 없으면 양식에서, 양식에 없으면 그대로, 2700A 짝(2700A-4)도', () => {
  const tpl = [
    { file: 'a', name: '2110A', code: '2110A', hidden: false }, { file: 'a', name: '2700A', code: '2700A', hidden: false },
    { file: 'a', name: '2700A-1(적용지침)', code: '2700A-1(적용지침)', hidden: false },
    { file: 'a', name: '2700A-2(감사계획단계)', code: '2700A-2(감사계획단계)', hidden: false },
    { file: 'a', name: '2700A-4(감사완결단계)', code: '2700A-4(감사완결단계)', hidden: false },
  ];
  const find = (c: string) => tpl.find((t) => t.code === c) ?? tpl.find((t) => t.code.replace(/\(.*$/, '') === c) ?? null;
  const plan = planLarge([
    { name: '1100(소규모)' }, { name: '2110A(소규모)' }, { name: '2110A', hidden: true },
    { name: '2700A (소규모)' }, { name: '2700A-1(적용지침)' }, { name: '2700A-1(소규모)', hidden: true }, { name: '2700A-2(소규모)' },
  ], find, tpl);
  assert.deepEqual(plan.steps.map((s) => `${s.small}>${s.to}:${s.how}`), [
    '2110A(소규모)>2110A:보이기', '2700A (소규모)>2700A:양식에서', '2700A-2(소규모)>2700A-2(감사계획단계):양식에서', '>2700A-4(감사완결단계):양식에서',
  ]);
});

test('다듬기 — 숨긴 소규모의 일반 짝이 숨어 있으면 보인다(차례는 조서 번호 순서가 맡는다)', () => {
  const t = planTidy([
    { name: '1200(소규모)', hidden: true }, { name: '2100(소규모)', hidden: true }, { name: '2100A' }, { name: '2700A (소규모)', hidden: true },
    { name: '8100' }, { name: '8700' }, { name: '1200' }, { name: '2100' }, { name: '2700A', hidden: true },
  ]);
  assert.deepEqual(t.show, ['2700A']);
});

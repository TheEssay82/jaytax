// 웹 조서 — 단계 상태, 2110A 읽기·쓰기, 엑셀 반영(바뀐 칸만·탭 색).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageStates, currentStage, confirmBlockers, stageLocked, type StageEvent } from './gwpStage';
import { PAPER_2110A } from './gwpPaper2110A';
import { applyWebPapers, changes } from './gwpApply';
import { emptyWorkbook } from './gwpAssemble';
import { injectSheets } from './xlsxInject';
import { readWorkbook } from './xlsxRead';
import { tabStateOf } from './xlsxMark';
import type { SheetCell } from './noteSheet';

const ev = (stage: 1 | 2 | 3, action: '확정' | '확정 취소', at: string, v: number | null = 3, reason: string | null = null): StageEvent =>
  ({ stage, action, bookVersion: v, reason, createdEmail: 'a@b', createdAt: at });

test('단계 상태 — 마지막 줄이 지금 상태, 확정 취소하면 풀린다', () => {
  const s = stageStates([ev(1, '확정', '2026-10-01T00:00'), ev(1, '확정 취소', '2026-10-02T00:00', null, '중요성 다시'), ev(2, '확정', '2026-11-01T00:00')]);
  assert.equal(s[0].confirmed, false);
  assert.equal(s[0].reopenReason, '중요성 다시');
  assert.equal(s[1].confirmed, true);
  assert.equal(currentStage(s), 1);
  assert.equal(stageLocked(2, s), true);
  assert.equal(stageLocked(1, s), false);
});

test('단계 확정 막는 것 — 앞 단계 미확정, 반영 안 한 웹 조서', () => {
  const s = stageStates([]);
  const papers = [{ code: '2110A', title: '업무분장표', stage: 1 as const, status: '작성중' }, { code: '2700A-3', title: '중요성', stage: 2 as const, status: null }];
  assert.deepEqual(confirmBlockers(1, s, papers), ['2110A 업무분장표 — 아직 엑셀에 반영하지 않았습니다.']);
  const b2 = confirmBlockers(2, s, papers);
  assert.equal(b2.length, 2);
  assert.match(b2[0], /1차 확정/);
  assert.deepEqual(confirmBlockers(1, s, [{ ...papers[0], status: '확인' }]), []);
});

// 명진 2110A 모양의 작은 워크북
function book2110A(): Uint8Array {
  const c = (row: number, col: number, text: string): SheetCell => ({ row, col, text });
  const cells: SheetCell[] = [
    c(1, 1, '2110A 업 무 분 장 표'),
    c(5, 1, '감 사 절 차'), c(5, 4, '중간감사'), c(5, 5, '기말감사'), c(5, 6, '검토'),
    c(6, 4, '담당자명'), c(6, 5, '담당자명'), c(6, 6, '담당자명'),
    c(7, 1, '(1) 감사계획의 수립'), c(7, 4, '정우철'), c(7, 5, '정우철'), c(7, 6, '조현규'),
    c(8, 1, '(2) 위험평가'),
    c(9, 1, '1) 회사의 사업등에 대한 이해'), c(9, 4, '정우철'), c(9, 5, '정우철'), c(9, 6, '조현규'),
    c(10, 1, '2) 유가증권(유동,비유동)'), c(10, 4, 'N/A'), c(10, 5, 'N/A'), c(10, 6, 'N/A'),
  ];
  return injectSheets(emptyWorkbook(), [{ name: '2110A(소규모)', cells, lastRow: 10 }]);
}

test('2110A — 작년 값을 읽고, 소제목 줄은 담당자 칸 없이', () => {
  const sheet = readWorkbook(book2110A())[0];
  const d = PAPER_2110A.read(sheet);
  assert.equal(d.rows.length, 4);
  assert.deepEqual(d.rows[0], { label: '(1) 감사계획의 수립', mid: '정우철', fin: '정우철', rev: '조현규' });
  assert.equal(d.rows[1].heading, true);
  assert.equal(d.rows[3].mid, 'N/A');
});

test('반영 — 그대로면 칸은 안 바꾸고 탭 초록, 바꾸면 그 칸만 쓰고 탭 노랑', () => {
  const bytes = book2110A();
  const sheet = readWorkbook(bytes)[0];
  const same = PAPER_2110A.read(sheet);
  const r1 = applyWebPapers(bytes, [{ def: PAPER_2110A, data: same }]);
  assert.deepEqual(r1.done, [{ code: '2110A', sheet: '2110A(소규모)', changed: 0 }]);
  assert.equal(tabStateOf(readWorkbook(r1.bytes)[0].tabColor), 'green');

  const edited = { rows: same.rows.map((r) => (r.label.startsWith('1)') ? { ...r, mid: '김준성', fin: '김준성' } : r)) };
  const r2 = applyWebPapers(bytes, [{ def: PAPER_2110A, data: edited }]);
  assert.equal(r2.done[0].changed, 2);
  const out = readWorkbook(r2.bytes)[0];
  assert.equal(out.cells.get('D9')?.text, '김준성');
  assert.equal(out.cells.get('F9')?.text, '조현규');
  assert.equal(tabStateOf(out.tabColor), 'yellow');
});

test('반영 — 시트가 없는 조서는 알려 준다', () => {
  const r = applyWebPapers(injectSheets(emptyWorkbook(), [{ name: '1100', cells: [{ row: 1, col: 1, text: 'x' }], lastRow: 1 }]), [{ def: PAPER_2110A, data: { rows: [] } }]);
  assert.deepEqual(r.missing, ['2110A']);
});

test('바뀌는가 — 같은 글자·숫자는 안 바뀜, 수식 칸에 값을 쓰면 바뀜', () => {
  assert.equal(changes({ text: '정우철' }, { ref: 'A1', text: '정우철 ' }), false);
  assert.equal(changes({ num: 5 }, { ref: 'A1', num: 5 }), false);
  assert.equal(changes({ formula: 'B1', num: 5 }, { ref: 'A1', num: 5 }), true);
  assert.equal(changes(undefined, { ref: 'A1', clear: true }), false);
  assert.equal(changes({ text: 'x' }, { ref: 'A1', clear: true }), true);
});

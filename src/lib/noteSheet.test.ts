import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asNumber, isDash, unitFactor, isTotalLabel, periodOfHead, bumpTerm, rollGrid, isPolicyNote,
  sheetName, addrOf, parseAddr, layoutNote, layoutNewNote, layoutIndex, NEW_NOTE_LINES,
} from './noteSheet.ts';
import type { NoteBlocks } from './dsdBlocks.ts';

/** 표 한 줄을 만든다 — 격자 열 번호를 차례로 매긴다(COLSPAN 없는 단순 표). */
function line(tag: 'TH' | 'TD', slot0: number, ...texts: string[]) {
  return texts.map((text, i) => ({ slot: slot0 + i, text, tag, col: i, colspan: 1, rowspan: 1 }));
}


test('표 안의 값 — 숫자는 숫자로, 퍼센트·글자는 그대로', () => {
  assert.equal(asNumber('32,000'), 32000);
  assert.equal(asNumber('15,419,575,880'), 15419575880);
  assert.equal(asNumber('(57,670)'), -57670);
  assert.equal(asNumber('0.5'), 0.5);
  assert.equal(asNumber('50%'), undefined);
  assert.equal(asNumber('-'), undefined);
  assert.equal(asNumber('이 종 명'), undefined);
  assert.equal(asNumber(''), undefined);
});

test('「-」는 0 을 뜻한다 — 붙임표 모양이 여럿이다', () => {
  assert.equal(isDash('-'), true);
  assert.equal(isDash(' - '), true);
  assert.equal(isDash('－'), true);
  assert.equal(isDash('—'), true);
  assert.equal(isDash(''), false);
  assert.equal(isDash('1-2'), false);
  assert.equal(isDash('합 계'), false);
});

const DASH_TABLE: NoteBlocks = {
  no: 8, title: '퇴직급여충당부채',
  blocks: [{
    kind: 'table',
    rows: [
      line('TH', 1, '구 분', '당 기'),
      line('TD', 3, '기 초', '197,666,666'),
      line('TD', 5, '지 급', '-'),
      line('TD', 7, '-', '210,166,666'),
    ],
  }],
};

test('숫자 열의 「-」는 0 으로 넣는다 — 안 그러면 합계가 안 잡힌다', () => {
  const p = layoutNote(DASH_TABLE, 'x');
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);
  // 표는 빈 줄 뒤 4행부터 — 4 머리 · 5 기초 · 6 지급(-) · 7 (-)/기말
  assert.equal(at(5, 4)?.num, 197666666);
  assert.equal(at(6, 4)?.num, 0, '숫자 열의 「-」는 0');
  assert.equal(at(6, 4)?.kind, 'num');
  assert.equal(at(6, 4)?.text, '-', '원문은 그대로 들고 있는다 — DSD 로 되돌릴 때 쓴다');
});

test('글자 열의 「-」는 0 으로 바꾸지 않는다 — 구분 이름이 숫자가 되면 안 된다', () => {
  const p = layoutNote(DASH_TABLE, 'x');
  const cell = p.cells.find((c) => c.row === 7 && c.col === 3);
  assert.equal(cell?.text, '-');
  assert.equal(cell?.num, undefined);
  assert.equal(cell?.kind, 'text');
});

test('표 머리의 「-」도 0 으로 바꾸지 않는다', () => {
  const head: NoteBlocks = {
    no: 1, title: 'x',
    blocks: [{ kind: 'table', rows: [line('TH', 1, '-', '당 기'), line('TD', 3, '가', '10')] }],
  };
  const p = layoutNote(head, 'x');
  assert.equal(p.cells.find((c) => c.row === 4 && c.col === 3)?.num, undefined);
});

test('단위에서 원으로 되돌리는 배수', () => {
  assert.equal(unitFactor('천원'), 1000);
  assert.equal(unitFactor('백만원'), 1000000);
  assert.equal(unitFactor('원'), null);
  assert.equal(unitFactor('천원,%'), null, '단위가 섞인 표는 손대지 않는다');
  assert.equal(unitFactor(undefined), null);
});

test('합계 행 판정 — 「기말」은 합계가 아니다', () => {
  assert.equal(isTotalLabel('합 계'), true);
  assert.equal(isTotalLabel('합계'), true);
  assert.equal(isTotalLabel('소  계'), true);
  assert.equal(isTotalLabel('계'), true);
  assert.equal(isTotalLabel('기 말'), false, '기초+증감=기말이라 SUM 으로 묶으면 두 배가 된다');
  assert.equal(isTotalLabel('당기말'), false);
  assert.equal(isTotalLabel('보통예금'), false);
});

const THOUSAND: NoteBlocks = {
  no: 3, title: '현금및현금성자산',
  blocks: [{
    kind: 'table',
    unit: '천원',
    rows: [
      line('TH', 1, '구분', '당기말'),
      line('TD', 3, '보유현금', '2,100'),
      line('TD', 5, '보통예금', '1,628,679'),
      line('TD', 7, '합계', '1,630,779'),
    ],
  }],
};

test('천원 표 — 원을 원본으로 두고 표시는 ROUND 로 유도한다', () => {
  const p = layoutNote(THOUSAND, 'x');
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);
  // 표는 4행부터: 4 머리 · 5 보유현금 · 6 보통예금 · 7 합계
  assert.equal(at(5, 4)?.formula, 'IF(F5="","",ROUND(F5/1000,0))', '표시는 원 칸에서 유도 · 빈칸은 빈칸으로');
  assert.equal(at(5, 4)?.num, undefined, '수식 칸에는 값을 같이 넣지 않는다');
  assert.equal(at(5, 6)?.num, 2100000, '원 단위 블록은 천원 × 1000');
  assert.equal(at(4, 6)?.text, '당기말', '원 블록도 머리글을 단다');
  assert.equal(at(3, 6)?.text, '원 단위 (입력)');
});

test('합계는 표시값끼리 더한다(㉮) · 단수차이를 옆에 보여 준다(㉯−㉮)', () => {
  const p = layoutNote(THOUSAND, 'x');
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);
  assert.equal(at(7, 4)?.formula, 'IF(COUNT(D5:D6)=0,"",SUM(D5:D6))', '보는 사람이 더해서 맞아야 한다 · 아직 안 채웠으면 빈칸');
  assert.equal(at(7, 6)?.formula, 'SUM(F5:F6)', '원 합계도 따라온다');
  assert.equal(at(7, 8)?.formula, 'ROUND(F7/1000,0)-D7', '단수차이');
  assert.equal(at(4, 8)?.text, '단수차이');
});

test('첫 해 표시값은 작년 DSD 와 같아야 한다 — ROUND(x×1000/1000)=x', () => {
  for (const x of [2100, 1628679, -161075, 0]) {
    assert.equal(Math.round((x * 1000) / 1000), x);
  }
});

test('원 단위 표는 그대로 둔다 — 수식을 걸지 않는다', () => {
  const won: NoteBlocks = {
    ...THOUSAND,
    blocks: [{ ...(THOUSAND.blocks[0] as { kind: 'table' } & Record<string, unknown>), unit: '원' } as never],
  };
  const p = layoutNote(won, 'x');
  assert.equal(p.cells.some((c) => c.formula), false);
  assert.equal(p.cells.find((c) => c.row === 5 && c.col === 4)?.num, 2100);
});

test('머리글에서 당기·전기를 가른다 — 「당기순손익」은 아니다', () => {
  assert.equal(periodOfHead('당기'), '당기');
  assert.equal(periodOfHead('당 기 말'), '당기');
  assert.equal(periodOfHead('제12(당)기'), '당기');
  assert.equal(periodOfHead('전기말'), '전기');
  assert.equal(periodOfHead('당기순손익'), null);
  assert.equal(periodOfHead('당기말현재연이자율(%)'), null);
  assert.equal(periodOfHead('구분'), null);
});

test('기수는 한 해 올린다', () => {
  assert.equal(bumpTerm('제12(당)기'), '제13(당)기');
  assert.equal(bumpTerm('제 11 (전)기'), '제12(전)기');
  assert.equal(bumpTerm('당기말'), '당기말', '기수가 없으면 그대로');
});

test('이월 — 전기 ← 당기, 당기는 빈칸', () => {
  const row = new Map([[0, '보유현금'], [1, '2,100'], [2, '914']]);
  const out = rollGrid([row], [[1, 2]], false, [1])[0];
  assert.equal(out.get(1), '', '당기는 빈칸');
  assert.equal(out.get(2), '2,100', '당기 값이 전기로 간다');
  assert.equal(out.get(0), '보유현금', '이름은 그대로');
});

test('이월 — 짝이 없으면 당기 열만 비운다', () => {
  const row = new Map([[0, '기초'], [1, '1,000']]);
  assert.equal(rollGrid([row], [], false, [1])[0].get(1), '');
});

test('이월 — COLSPAN 으로 덮인 열도 제대로 짝지어진다', () => {
  // 명진 5. 재고자산: 구분 │ 총보유면적(2열) │ 당기(2열) │ 전기(2열)
  const row = new Map([[0, '건설용지'], [1, '46,983'], [2, '46,983'],
    [3, '12,782,961,300'], [4, '15,395,077,620'], [5, '12,403,085,900'], [6, '12,000']]);
  const out = rollGrid([row], [[1, 2], [3, 5], [4, 6]], false, [])[0];
  assert.equal(out.get(3), '', '당기 장부가액은 빈칸');
  assert.equal(out.get(5), '12,782,961,300', '전기 장부가액으로 내려온다');
  assert.equal(out.get(6), '15,395,077,620', '전기 공시지가로 내려온다');
});

test('이월한 시트 — 당기 입력칸은 노랗게 비고 전기는 값이 든다', () => {
  const p = layoutNote({
    no: 3, title: '현금',
    blocks: [{
      kind: 'table', unit: '천원',
      rows: [
        line('TH', 1, '구분', '당기말', '전기말'),
        line('TD', 4, '보유현금', '2,100', '914'),
      ],
    }],
  }, 'x', { roll: true });
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);
  // 표는 4행부터(머리) · 5행 자료 / 원 블록은 G(7)·H(8)
  assert.equal(at(5, 7)?.kind, 'input', '당기 원 칸은 채워 넣을 자리');
  assert.equal(at(5, 7)?.num, undefined);
  assert.equal(at(5, 8)?.num, 2100000, '전기 원 칸에 작년 당기 값이 들어온다');
  assert.equal(at(5, 4)?.formula, 'IF(G5="","",ROUND(G5/1000,0))', '빈 입력칸은 빈칸으로 보인다');
});

test('정책 주석은 이월에서 손대지 않는다 — 내용연수는 해마다 안 바뀐다', () => {
  assert.equal(isPolicyNote('중요한 회계처리방침'), true);
  assert.equal(isPolicyNote('유의적인 회계정책'), true);
  assert.equal(isPolicyNote('중요한 판단과 추정불확실성의 주요 원천'), true);
  assert.equal(isPolicyNote('담보제공자산 등'), false);
  assert.equal(isPolicyNote('유형자산'), false);
});

test('전부 「-」인 열도 숫자 열 — 이월하면 비워야 한다', () => {
  // 명진 6. 유형자산의 취득·처분·대체가 작년에 전부 「-」였다.
  const p = layoutNote({
    no: 6, title: '유형자산', period: undefined,
    blocks: [{ kind: 'table', period: '당기', rows: [
      line('TH', 1, '구 분', '기 초', '취 득'),
      line('TD', 4, '차량운반구', '13,817,425', '-'),
    ] }],
  } as never, 'x', { roll: true });
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);
  assert.equal(at(5, 4)?.kind, 'input', '기초는 당연히 비운다');
  assert.equal(at(5, 5)?.kind, 'input', '전부 「-」인 취득 열도 비운다');
});

test('머리에 「당기」가 들어 있으면 글자 칸도 비운다', () => {
  // 알티스트 9. 차입금의 「당기말 현재 연이자율(%)」이 글자라서 안 비워졌었다.
  const p = layoutNote({
    no: 9, title: '차입금',
    blocks: [{ kind: 'table', rows: [
      line('TH', 1, '구 분', '당기말 현재 연이자율(%)', '전기말'),
      line('TD', 4, '일반자금대출', '4.245-4.708', '5,200,000'),
    ] }],
  } as never, 'x', { roll: true });
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);
  assert.equal(at(5, 4)?.kind, 'input');
  assert.equal(at(5, 4)?.text, '');
});

test('전기 열이 하나도 없는 표는 첫 열만 남기고 비운다 — 담보·보증 내역', () => {
  const p = layoutNote({
    no: 13, title: '담보제공자산 등',
    blocks: [{ kind: 'table', rows: [
      line('TH', 1, '구 분', '제공자', '내용', '금액'),
      line('TD', 5, '지급보증 등', '대표이사 등', '부동산', '8,400,000,000'),
    ] }],
  } as never, 'x', { roll: true });
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);
  assert.equal(at(5, 3)?.text, '지급보증 등', '구분 이름은 남는다');
  assert.equal(at(5, 4)?.kind, 'input', '제공자도 새로 적는다');
  assert.equal(at(5, 5)?.kind, 'input', '내용도 새로 적는다');
  assert.equal(at(5, 6)?.kind, 'input', '금액도 새로 적는다');
});

test('시트 이름 — 금지 글자와 31자 제한, 겹치면 번호', () => {
  const used = new Set<string>();
  assert.equal(sheetName('재고자산', used), '재고자산');
  assert.equal(sheetName('재고자산', used), '재고자산(2)');
  assert.equal(sheetName('현금흐름/표', used), '현금흐름 표');
  const long = sheetName('금융부채의 유동성 위험관리 방법 및 종류별 만기 분석 그리고 더', used);
  assert.ok(long.length <= 31, long);
  assert.equal(sheetName('', used), '주석');
});

test('자리표 — 넣었다 빼도 같다', () => {
  assert.equal(addrOf(176), '176');
  assert.equal(addrOf(176, 2), '176#2');
  assert.deepEqual(parseAddr('176'), { slot: 176, part: null });
  assert.deepEqual(parseAddr('176#2'), { slot: 176, part: 2 });
  assert.equal(parseAddr('가나다'), null);
  assert.equal(parseAddr(null), null);
});

const NOTE: NoteBlocks = {
  no: 1,
  title: '회사의 개요',
  blocks: [
    { kind: 'para', slot: 176, parts: ['첫째 문단.', '둘째 문단.'] },
    {
      kind: 'table',
      rows: [
        line('TH', 177, '구    분', '주식수(주)'),
        line('TD', 179, '이 종 명', '32,000'),
      ],
    },
    { kind: 'para', slot: 190, parts: ['표 뒤 문단.'] },
  ],
};

test('배치 — 정산표가 쓰던 모양 그대로', () => {
  const p = layoutNote(NOTE, '회사의 개요');
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);

  assert.equal(at(2, 2)?.text, '주석명');
  assert.equal(at(2, 3)?.text, '1. 회사의 개요');

  // 문단은 C열에 붙여서
  assert.equal(at(3, 3)?.text, '첫째 문단.');
  assert.equal(at(4, 3)?.text, '둘째 문단.');

  // 표 앞에 빈 줄 → 5행은 비고 6행부터 표
  assert.equal(at(5, 3), undefined);
  assert.equal(at(6, 3)?.text, '구    분');
  assert.equal(at(6, 4)?.text, '주식수(주)');
  assert.equal(at(7, 4)?.num, 32000, '표 안의 숫자는 숫자로 들어간다');

  // 표 뒤에도 한 줄 띄운다
  assert.equal(at(8, 3), undefined);
  assert.equal(at(9, 3)?.text, '표 뒤 문단.');
  assert.equal(p.lastRow, 9);
});

test('자리표가 A열에 숨어 따라간다', () => {
  const p = layoutNote(NOTE, 'x');
  const a = (row: number) => p.cells.find((c) => c.row === row && c.col === 1)?.text;
  assert.equal(a(3), '176#0', '한 P 안의 여러 문단은 몇 번째인지까지 적는다');
  assert.equal(a(4), '176#1');
  assert.equal(a(6), '177 178', '표는 한 줄의 칸들을 나란히');
  assert.equal(a(9), '190', '문단이 하나뿐이면 번호를 안 붙인다');
});

test('주석 목록 시트 — 정산표의 「주석번호·주석제목·사용여부」', () => {
  const p = layoutIndex([
    { no: 1, title: '회사의 개요', enabled: true, sheet: '회사의 개요' },
    { no: null, title: '쓰지 않음', enabled: false, sheet: '쓰지 않음' },
  ]);
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);
  assert.equal(at(2, 2)?.text, '주석번호');
  assert.equal(at(3, 4)?.text, 'O');
  assert.equal(at(4, 4)?.text, 'X');
  assert.equal(at(4, 2), undefined, '꺼진 주석은 번호가 없다');
  assert.equal(p.lastRow, 4);
});

// ── 단위 표지판은 자료가 아니다 ─────────────────────────────────
// 「(단위: 원)」은 빈 칸 하나 + 단위 글자 하나짜리 표로 들어온다. 전기 열이 없으니
// 「통째로 올해 자료」 규칙에 걸려 글자가 지워지고 노랗게 칠해졌다 — 명진 15. 부가가치계산.
const UNIT_MARK: NoteBlocks = {
  no: 15, title: '부가가치계산에 필요한 사항',
  blocks: [
    { kind: 'table', isUnitMark: true, unit: '원', rows: [line('TD', 700, '', '(단위: 원)')] },
    {
      kind: 'table', unit: '원',
      rows: [
        line('TH', 710, '구 분', '당 기', '전 기'),
        line('TD', 720, '급여', '150,000,000', '150,000,000'),
      ],
    },
  ],
};

test('단위 표지판은 이월해도 지우지 않는다 — 노랗게 칠하지도 않는다', () => {
  const plan = layoutNote(UNIT_MARK, 'N15', { roll: true });
  const at = (row: number, col: number) => plan.cells.find((c) => c.row === row && c.col === col);
  // 표지판 줄 — 글자가 그대로 있고 입력칸이 아니다
  const mark = plan.cells.find((c) => c.text === '(단위: 원)');
  assert.ok(mark, '「(단위: 원)」이 사라졌다');
  assert.notEqual(mark!.kind, 'input');
  assert.equal(plan.cells.filter((c) => c.kind === 'input' && c.row === mark!.row).length, 0);
  // 정작 자료 표는 그대로 이월된다
  const body = plan.cells.filter((c) => c.kind === 'input');
  assert.equal(body.length, 1, '자료 표의 당기 칸 하나만 비어야 한다');
  assert.equal(body[0].row, mark!.row + 3);        // 표지판 · 빈 줄 · 머리 · 본문
  assert.equal(at(body[0].row, 5)?.text, '150,000,000');   // 전기로 내려왔다
});

test('작년에 없던 주석 — 빈 서식 한 장을 만든다', () => {
  const plan = layoutNewNote(19, '리스', 'N19 리스');
  assert.equal(plan.cells.find((c) => c.kind === 'title')?.text, '19. 리스');
  // 채워 넣을 줄은 노란 입력칸
  const input = plan.cells.filter((c) => c.kind === 'input');
  assert.equal(input.length, NEW_NOTE_LINES);
  assert.ok(input.every((c) => c.col === 3 && c.text === ''));
  // **자리표가 없다** — 원본에 대응할 자리가 없다는 뜻이다
  assert.equal(plan.cells.filter((c) => c.col === 1).length, 0);
  assert.equal(plan.lastRow, 4 + NEW_NOTE_LINES);
});

test('번호가 아직 없는 새 주석이면 제목만 쓴다', () => {
  const plan = layoutNewNote(null, '리스', 'N19 리스');
  assert.equal(plan.cells.find((c) => c.kind === 'title')?.text, '리스');
});

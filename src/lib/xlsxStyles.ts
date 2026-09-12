// 원본 엑셀의 `xl/styles.xml` **뒤에 우리 서식을 덧붙인다.**
//
// 왜 덧붙이는가: 서식은 번호(index)로 참조된다. 명진 정산표에는 이미 글꼴 44개·채우기 14개·
// 테두리 49개·셀서식 331개가 있고, 앞쪽을 건드리면 **원본 셀들의 서식이 통째로 어긋난다.**
// 그래서 맨 뒤에만 더하고, 우리가 만든 시트만 그 번호를 쓴다.
//
// 무엇을 더하는가:
//   · 천단위 쉼표 숫자꼴 — 「1,234」·음수는 「(1,234)」
//   · 얇은 테두리 · 머리행 음영 — 표가 표로 보이게(2026-09-12 지적)

export interface StyleIds {
  /** 「주석명」 같은 라벨 — 굵게 */ label: number;
  /** 주석 제목 — 굵고 크게 */ title: number;
  /** 서술 문단 — 테두리 없음 */ para: number;
  /** 표 머리 — 테두리 + 음영 + 굵게 + 가운데 */ head: number;
  /** 표 글자칸 — 테두리 */ text: number;
  /** 표 숫자칸 — 테두리 + 천단위 쉼표 + 오른쪽 */ num: number;
}

const THIN = '<left style="thin"><color rgb="FFB7BDC6"/></left>'
  + '<right style="thin"><color rgb="FFB7BDC6"/></right>'
  + '<top style="thin"><color rgb="FFB7BDC6"/></top>'
  + '<bottom style="thin"><color rgb="FFB7BDC6"/></bottom><diagonal/>';

/** 여는 태그 하나를 찾아 count 를 올리고 닫는 태그 앞에 내용을 끼워 넣는다. */
function appendTo(xml: string, tag: string, items: string[]): { xml: string; first: number } {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`);
  const m = open.exec(xml);
  if (!m) throw new Error(`styles.xml 에 <${tag}> 가 없습니다.`);
  const countM = /count="(\d+)"/.exec(m[0]);
  const first = countM ? Number(countM[1]) : 0;
  const head = countM
    ? m[0].replace(/count="\d+"/, `count="${first + items.length}"`)
    : m[0];
  let out = xml.slice(0, m.index) + head + xml.slice(m.index + m[0].length);
  const close = `</${tag}>`;
  const at = out.indexOf(close, m.index);
  if (at < 0) throw new Error(`styles.xml 의 <${tag}> 가 닫히지 않았습니다.`);
  out = out.slice(0, at) + items.join('') + out.slice(at);
  return { xml: out, first };
}

/**
 * 서식을 덧붙이고 우리가 쓸 번호를 돌려준다.
 *
 * styleSheet 안의 차례(numFmts → fonts → fills → borders → cellStyleXfs → cellXfs)는
 * 스키마가 정한 것이라 지켜야 한다. numFmts 가 아예 없으면 fonts 앞에 새로 만든다.
 */
export function addNoteStyles(stylesXml: string): { xml: string; ids: StyleIds } {
  let xml = stylesXml;

  // ① 숫자꼴 — 164 이상이 사용자 정의 자리다. 겹치지 않는 번호를 고른다.
  const usedFmt = [...xml.matchAll(/numFmtId="(\d+)"/g)].map((m) => Number(m[1]));
  const fmtId = Math.max(163, ...usedFmt) + 1;
  const numFmt = `<numFmt numFmtId="${fmtId}" formatCode="#,##0;(#,##0);&quot;-&quot;"/>`;
  if (/<numFmts[\s>]/.test(xml)) {
    xml = appendTo(xml, 'numFmts', [numFmt]).xml;
  } else {
    const at = xml.search(/<fonts[\s>]/);
    if (at < 0) throw new Error('styles.xml 에 <fonts> 가 없습니다.');
    xml = `${xml.slice(0, at)}<numFmts count="1">${numFmt}</numFmts>${xml.slice(at)}`;
  }

  // ② 글꼴 — 보통 하나, 굵게 하나
  const f = appendTo(xml, 'fonts', [
    '<font><sz val="10"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>',
    '<font><b/><sz val="10"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>',
    '<font><b/><sz val="12"/><color rgb="FF1A2B52"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>',
  ]);
  xml = f.xml;
  const fontBase = f.first;
  const fontBold = f.first + 1;
  const fontTitle = f.first + 2;

  // ③ 채우기 — 머리행 음영
  const fl = appendTo(xml, 'fills', [
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEDF0F5"/><bgColor indexed="64"/></patternFill></fill>',
  ]);
  xml = fl.xml;
  const fillHead = fl.first;

  // ④ 테두리 — 얇은 네 변
  const b = appendTo(xml, 'borders', [`<border>${THIN}</border>`]);
  xml = b.xml;
  const borderThin = b.first;

  // ⑤ 셀서식 — 위의 것들을 엮는다
  const xf = (font: number, fill: number, border: number, fmt: number, extra = '') =>
    `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"`
    + `${fmt ? ' applyNumberFormat="1"' : ''} applyFont="1"${fill ? ' applyFill="1"' : ''}`
    + `${border ? ' applyBorder="1"' : ''}${extra ? ` applyAlignment="1">${extra}</xf>` : '/>'}`;

  const c = appendTo(xml, 'cellXfs', [
    xf(fontBold, 0, 0, 0),                                                              // label
    xf(fontTitle, 0, 0, 0),                                                             // title
    xf(fontBase, 0, 0, 0, '<alignment vertical="top"/>'),                               // para
    xf(fontBold, fillHead, borderThin, 0, '<alignment horizontal="center" vertical="center"/>'), // head
    xf(fontBase, 0, borderThin, 0, '<alignment vertical="center"/>'),                   // text
    xf(fontBase, 0, borderThin, fmtId, '<alignment horizontal="right" vertical="center"/>'), // num
  ]);
  xml = c.xml;

  return {
    xml,
    ids: {
      label: c.first, title: c.first + 1, para: c.first + 2,
      head: c.first + 3, text: c.first + 4, num: c.first + 5,
    },
  };
}

/** styles.xml 이 아예 없는 파일을 위한 최소한의 것. */
export const MINIMAL_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
  + '</styleSheet>';

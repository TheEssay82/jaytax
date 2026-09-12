// .dsd 파일을 브라우저에서 연다.
//
// DSD 는 확장자만 다를 뿐 **ZIP** 이고 안에 `contents.xml`(본문)과 `meta.xml`(편집기 버전·문서종류)이
// 들어 있다. 그래서 DART 편집기를 구동할 필요가 없고, 데스크톱 프로그램도 필요 없다.
//
// ⚠️ **파일은 서버로 올라가지 않는다.** 여기서 읽은 것은 브라우저 메모리에만 있고,
//    남기는 것은 주석 목록뿐이다(미공시 재무정보를 클라우드에 쌓지 않는다).
import { unzipSync, strFromU8 } from 'fflate';
import { parseNoteList, documentName, documentPeriod, type ParsedNote } from './dsdParse';

export type { ParsedNote } from './dsdParse';

export interface DsdInfo {
  /** 감사보고서 · 감사전 재무제표 등 */
  docName: string;
  period: { from: string; to: string } | null;
  notes: ParsedNote[];
  /** 편집기 버전 — 파일이 어느 세대인지 알려 준다. */
  editorVersion: string;
}

/** .dsd 한 개를 읽어 주석 목록까지 뽑는다. ZIP 이 아니면 알아듣게 알려 준다. */
export async function readDsd(file: File): Promise<DsdInfo> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    throw new Error('DSD 파일이 아닌 것 같습니다(ZIP 형식이 아닙니다). DART 편집기에서 저장한 .dsd 를 넣어 주세요.');
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf);
  } catch {
    throw new Error('파일을 열지 못했습니다. 손상되었거나 DSD 가 아닐 수 있습니다.');
  }
  const body = files['contents.xml'];
  if (!body) throw new Error('DSD 안에 본문(contents.xml)이 없습니다.');
  const xml = strFromU8(body);
  const meta = files['meta.xml'] ? strFromU8(files['meta.xml']) : '';
  return {
    docName: documentName(xml),
    period: documentPeriod(xml),
    notes: parseNoteList(xml),
    editorVersion: /editver="([^"]*)"/.exec(meta)?.[1] ?? '',
  };
}

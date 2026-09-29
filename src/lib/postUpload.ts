// 우체국 「우편 업로드 양식」 — 문서발송 요청을 우체국 접수용 엑셀(.xls)로 내려받는다.
//
// 사용자 2026-09-29: 「문서발송관리와 연계하여 우체국업무시 첨부양식으로 발송정보를 내려받을 수 있게 … G,H열은 기입할 정보가
// 없으므로 공란 … 다운로드시 담을 발송요청정보를 선택할 수 있게」. 양식(D:\Dropbox\9.행정폴더\발송업무_Control\우편 업로드 양식.xls):
//   시트 「template」, 1행 머리 —
//   A 받는 분 · B 우편번호 · C 주소(시도+시군구+도로명+건물번호) · D 상세주소(동, 호수, 洞명칭, 아파트, 건물명 등)
//   E 일반전화(02-1234-5678) · F 휴대전화(010-1234-5678) · G 등기번호(선납소포라벨만 입력가능) · H 중량(g)
// 담당자 주소는 한 칸이라 내려받을 때 나눈다 — 「서울 마포구 마포대로12길 34, 3층(공덕동, 소담빌딩)」 → C 「… 34」 · D 「3층(공덕동, 소담빌딩)」.
import { recipientLabel } from './honorific';
import type { SendRequest } from './docSendApi';

export const POST_HEAD = [
  '받는 분', '우편번호', '주소(시도+시군구+도로명+건물번호)', '상세주소(동, 호수, 洞명칭, 아파트, 건물명 등)',
  '일반전화(02-1234-5678)', '휴대전화(010-1234-5678)', '등기번호(선납소포라벨만 입력가능)', '중량(g)',
];

export interface PostRow {
  /** 발송요청 id */ id: string;
  /** 우편번호를 저장할 거래처담당자 — 없으면 저장하지 않는다 */ bizContactId: string | null;
  name: string; zip: string; addr: string; detail: string; tel: string; mobile: string;
}

/** 주소 속 우편번호 — 「(06236) 서울…」·「서울 … 06236」. 떼어 낸 주소와 함께. */
export function takeZip(address: string): { zip: string; rest: string } {
  const m = /(^|[\s([])(\d{5})(?=[\s)\]]|$)/.exec(address);
  if (!m) return { zip: '', rest: address.trim() };
  const rest = (address.slice(0, m.index) + address.slice(m.index + m[0].length).replace(/^[)\]]/, '')).replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
  return { zip: m[2], rest };
}

/**
 * 도로명주소 → (시도+시군구+도로명+건물번호, 상세). 도로명(…로·…길) 뒤 건물번호까지가 앞, 나머지(쉼표·괄호·층·호)가 뒤.
 * 도로명을 못 찾으면(지번 주소) 첫 쉼표에서 나눈다. 둘 다 없으면 통째로 앞.
 */
export function splitAddress(address: string): { addr: string; detail: string } {
  const a = address.replace(/\s+/g, ' ').trim();
  const m = /^(.*?(?:로|길)\s*\d+(?:-\d+)?)(?=$|[\s,(])\s*,?\s*(.*)$/.exec(a);
  if (m && /(시|도|군|구)\s/.test(m[1])) return { addr: m[1].trim(), detail: m[2].trim() };
  // 지번 주소 — 「서울 서초구 방배동 919-1 지호빌딩 204호」 → 번지까지 / 나머지.
  const j = /^(.*?(?:동|리|가)\s*\d+(?:-\d+)?)(?=$|[\s,(])\s*,?\s*(.*)$/.exec(a);
  if (j && /(시|도|군|구)\s/.test(j[1])) return { addr: j[1].trim(), detail: j[2].trim() };
  const c = a.indexOf(',');
  return c > 0 ? { addr: a.slice(0, c).trim(), detail: a.slice(c + 1).trim() } : { addr: a, detail: '' };
}

/** 전화 → 일반전화·휴대전화. 「010-…」은 휴대, 그 밖은 일반. 두 번호가 함께 적혀 있으면 나눠 담는다. */
export function splitPhone(phone: string): { tel: string; mobile: string } {
  const nums = phone.match(/0\d{1,2}[-.\s)]?\d{3,4}[-.\s]?\d{4}/g) ?? (phone.trim() ? [phone.trim()] : []);
  let tel = '', mobile = '';
  for (const n of nums) {
    const d = n.replace(/[^\d]/g, '');
    const fmt = d.length >= 9 ? (d.startsWith('02') ? `02-${d.slice(2, -4)}-${d.slice(-4)}` : `${d.slice(0, 3)}-${d.slice(3, -4)}-${d.slice(-4)}`) : n.trim();
    if (/^01[016789]/.test(d)) { if (!mobile) mobile = fmt; } else if (!tel) tel = fmt;
  }
  return { tel, mobile };
}

/** 발송요청 → 양식 한 줄. zipOf = 담당자에 저장된 우편번호. */
export function toPostRow(r: SendRequest, contact: { bizContactId: string | null; zip: string | null } | undefined): PostRow {
  const z = takeZip(r.address || '');
  const { addr, detail } = splitAddress(z.rest);
  const { tel, mobile } = splitPhone(r.phone || '');
  const who = r.recipientName ? recipientLabel(r.recipientName, r.recipientTitle) : '';
  return {
    id: r.id, bizContactId: contact?.bizContactId ?? null,
    name: [r.companyName, who].filter(Boolean).join(' '),
    zip: contact?.zip || z.zip, addr, detail, tel, mobile,
  };
}

/** 양식 .xls(시트 「template」) 바이트 — G·H 는 비운다. */
export async function postUploadXls(rows: PostRow[]): Promise<Uint8Array> {
  const XLSX = await import('xlsx');
  const aoa = [POST_HEAD, ...rows.map((r) => [r.name, r.zip, r.addr, r.detail, r.tel, r.mobile, '', ''])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 우편번호·전화는 글자로 — 「06236」의 앞 0 이 떨어지지 않게.
  rows.forEach((_, i) => { for (const c of ['B', 'E', 'F']) { const cell = ws[`${c}${i + 2}`]; if (cell) { cell.t = 's'; cell.v = String(cell.v); } } });
  ws['!cols'] = [18, 10, 40, 34, 16, 16, 20, 10].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'template');
  return new Uint8Array(XLSX.write(wb, { bookType: 'biff8', type: 'array' }) as ArrayBuffer);
}

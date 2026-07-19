// 발송업무 현황 → 엑셀(.xlsx) 내보내기.
// 화면에서 필터·정렬한 결과(view)를 그대로 받아 저장하므로, 보이는 것과 파일이 일치한다.
import * as XLSX from 'xlsx';
import type { SendRequest } from './docSendApi';

const HEADERS = [
  '상태', '사유·메모', '의뢰일자', '의뢰인', '거래처', '수신자', '직위',
  '업무구분', '송부종류', '문서명', '기타요청사항', '부수', '날인', '기한',
  '발송일', '등기번호', '주소', '연락처',
] as const;

/** 파일명에 쓸 기간 라벨. 기간 미지정이면 '전체기간'. */
function periodLabel(from: string, to: string): string {
  if (!from && !to) return '전체기간';
  const c = (s: string) => s.replace(/-/g, '');
  if (from && to) return `${c(from)}-${c(to)}`;
  return from ? `${c(from)}부터` : `${c(to)}까지`;
}

export interface ExportMeta {
  /** 기간 기준일 — 파일 안내행에 남긴다. */
  basis: '의뢰일자' | '발송일';
  from: string;
  to: string;
  /** 화면에 걸려 있던 상태 필터 라벨 */
  statusLabel: string;
}

/** 현황 목록을 엑셀로 저장한다. rows 는 화면에 보이는 순서 그대로. */
export function exportSendStatus(rows: SendRequest[], meta: ExportMeta): void {
  const info = [
    `기간: ${meta.basis} ${meta.from || '처음'} ~ ${meta.to || '오늘'}`,
    `상태필터: ${meta.statusLabel}`,
    `총 ${rows.length}건`,
  ].join('   |   ');

  const body = rows.map((r) => [
    r.status,
    r.statusNote,
    r.requestDate,
    r.requester,
    r.companyName,
    r.recipientName,
    r.recipientTitle,
    r.workType,
    r.sendKind,
    r.docName,
    r.etcRequest,
    r.copies,
    r.sealRequired ? '날인요' : '',
    r.deadline,
    r.sentDate || '',
    r.trackingNo,
    r.address,
    r.phone,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([[info], [...HEADERS], ...body]);
  // 안내행을 헤더 폭만큼 병합해 한 줄로 보이게 한다.
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: HEADERS.length - 1 } }];
  ws['!cols'] = HEADERS.map((h) => {
    if (h === '문서명' || h === '주소' || h === '기타요청사항' || h === '사유·메모') return { wch: 34 };
    if (h === '거래처' || h === '등기번호') return { wch: 18 };
    if (h === '부수' || h === '날인' || h === '기한') return { wch: 7 };
    return { wch: 12 };
  });
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '발송업무현황');
  XLSX.writeFile(wb, `발송업무현황_${periodLabel(meta.from, meta.to)}.xlsx`);
}

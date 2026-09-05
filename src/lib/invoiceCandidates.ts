// 「이 달 무엇을 청구할 후보로 올릴까」 — 그 규칙 **한 곳**. supabase 를 물지 않는다.
//
// 왜 떼어내나: 이 규칙들이 listInvoiceCandidates 안에 섞여 있어 테스트가 돌지 않았다.
// 돈이 지나가는 자리인데 자동 검사가 없었다 — 담당직원(contractStaff)·회수율
// (confirmProgress)·연환산(annualize)에서 했던 방식 그대로 뗀다.

/** 이미 요청된 건인가를 가르는 열쇠. 계약 + 분할회차로 한 건을 가린다. */
export function candidateKey(contractId: string, installmentId: string | null | undefined): string {
  return `${contractId}|${installmentId ?? ''}`;
}

/**
 * 이미 올라간 요청들의 열쇠 묶음.
 *
 * **취소된 건은 세지 않는다** — 취소한 뒤에는 다시 올릴 수 있어야 한다.
 * 여기서 취소를 빼먹으면 잘못 올렸다 취소한 건을 영영 다시 못 올린다.
 */
export function takenKeys(
  existing: { status: string; contractId: string | null; installmentId: string | null }[],
): Set<string> {
  return new Set(
    existing.filter((r) => r.status !== '취소')
      .map((r) => candidateKey(r.contractId ?? '', r.installmentId)),
  );
}

/** 후보로 올릴 값인가 — 이미 올라갔거나 금액이 0 이하면 올리지 않는다. */
export function isCandidate(key: string, net: number, taken: Set<string>): boolean {
  if (taken.has(key)) return false;
  // 0원·음수는 청구할 것이 없다. 종속계약(청구금액 0)이 여기 해당한다.
  return net > 0;
}

export interface ContactLike {
  placeId: string | null;
  email: string;
  isPrimary: boolean;
  /** false = 이직·퇴사로 접어 둔 담당자. **보내면 안 된다.** */
  active: boolean;
}

/**
 * 세금계산서를 보낼 주소를 고른다.
 * 순서: 그 사업장의 대표연락처 → 그 사업장의 아무나 → 거래처 대표연락처 → 아무나.
 * 접어 둔 담당자(active=false)는 어느 단계에서도 고르지 않는다.
 */
export function pickDocEmail(contacts: ContactLike[], placeId: string | null): string {
  const cs = contacts.filter((c) => c.email.trim() && c.active);
  if (!cs.length) return '';
  return (placeId ? cs.find((c) => c.placeId === placeId && c.isPrimary)?.email : '')
    || (placeId ? cs.find((c) => c.placeId === placeId)?.email : '')
    || cs.find((c) => c.isPrimary)?.email
    || cs[0].email;
}

export interface PlaceLike { id: string; placeName: string; isHeadquarters: boolean }

/**
 * 계약이 걸린 사업장을 고른다 — 계약에 적힌 곳 → 본사 → 첫 곳.
 * 계약에 사업장이 없는 건이 많아(2026-09 기준 139건) 본사로 대신 잡는 이 규칙이 실제로 쓰인다.
 */
export function pickPlace(places: PlaceLike[], contractPlaceId: string | null): PlaceLike | undefined {
  return places.find((p) => p.id === contractPlaceId)
    ?? places.find((p) => p.isHeadquarters)
    ?? places[0];
}

/** 우리 매출유형 → ERP 매출계정 (2026-09-01 사용자 확정). */
export type ErpAccountName = '기장대리수입' | '세무조정수입' | '회계감사수입' | '기타용역수입';

export function erpAccountOf(categoryCode: string): ErpAccountName {
  const c = categoryCode || '';
  // 부가세 신고대리·원천세는 **세무조정이 아니라 기장**이다(사용자 확정).
  if (c === 'TAX.BOOK' || c === 'TAX.FILING.VAT' || c === 'TAX.FILING.WHT') return '기장대리수입';
  if (c.startsWith('TAX.FILING') || c.startsWith('AUD.SVC.FILING')) return '세무조정수입';
  if (c === 'AUD.AUDIT') return '회계감사수입';
  return '기타용역수입';
}

// ── 감사팀 제안(분할회차 알림) ──────────────────────────────

export interface InstallmentLike {
  id?: string | null;
  /** 청구기한. 없으면 알릴 수 없다. */
  dueDate: string | null;
  /** 이미 청구한 회차는 다시 알리지 않는다. */
  billedAt?: string | null;
}

/**
 * 이 회차를 「청구할 때가 됐다」로 알릴까.
 *
 * · 청구기한이 없으면 알리지 않는다 — 언제인지 모르는 것을 재촉할 수 없다.
 * · 이미 청구한 회차(billedAt)는 알리지 않는다.
 * · `withinDays` 만큼 **미리** 알린다. 0 이면 기한이 지난 것만.
 *
 * overdue 는 **지난 날수**다(양수=밀림, 음수=아직 남음).
 */
export function shouldPropose(
  it: InstallmentLike, overdueDays: number, withinDays: number,
): boolean {
  if (!it.dueDate) return false;
  if (it.billedAt) return false;
  return overdueDays >= -withinDays;
}

/** 밀린 순서가 곧 급한 순서다 — 오래 지난 것부터, 같으면 이름순. */
export function byUrgency<T extends { overdueDays: number; companyName: string }>(a: T, b: T): number {
  return b.overdueDays - a.overdueDays || a.companyName.localeCompare(b.companyName, 'ko');
}

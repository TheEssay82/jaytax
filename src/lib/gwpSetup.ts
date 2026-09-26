// 일반조서 당기 세팅의 규칙 — DB 를 건드리지 않는 순수 모듈(테스트에서 그대로 부른다).
//
// 조서 양식 기준(K-IFRS·일반·소규모)과 재무제표 회계기준(K-IFRS·일반기업)은 다른 값이다(설계서 3절).
// 일반↔소규모는 해마다 감사계약 때 바뀔 수 있어 당기 세팅에서 따로 받는다(사용자 결정 2026-09-26).

/** 조서 양식 기준 — 표준양식 묶음(gwp_template.basis)과 같은 문자열. */
export type AuditBasis = 'K-IFRS' | '일반기업회계기준' | '소규모감사기준';
export const AUDIT_BASES: AuditBasis[] = ['K-IFRS', '일반기업회계기준', '소규모감사기준'];
/** 화면에서 부르는 짧은 이름. */
export const AUDIT_BASIS_LABEL: Record<AuditBasis, string> = {
  'K-IFRS': 'K-IFRS', 일반기업회계기준: '일반', 소규모감사기준: '소규모',
};

/** 재무제표 회계기준(주석·DSD) — 두 값뿐이다. */
export type FsBasis = 'K-IFRS' | '일반기업회계기준';

/** 조서 기준에서 재무제표 회계기준을 끌어낸다 — K-IFRS 조서면 K-IFRS, 일반·소규모면 일반기업회계기준. */
export function fsBasisOf(a: AuditBasis): FsBasis {
  return a === 'K-IFRS' ? 'K-IFRS' : '일반기업회계기준';
}

/** 조서 기준과 주석·DSD 회계기준이 어긋나는가(조서는 K-IFRS 인데 재무제표는 일반기업 등). */
export function basisMismatch(a: AuditBasis, fs: string): boolean {
  return fsBasisOf(a) !== fs;
}

/** 검토자(파트너) 기본값 — 2026-09 지금은 전 회사 조현규(사용자 2026-09-25). */
export const DEFAULT_PARTNER = '조현규';

/**
 * 감사 매출계약의 담당회계사 → 작성자 기본값.
 * 지정감사는 개인 이름 대신 「법인(지정)」이 들어 있어 작성자가 될 수 없다 — 그때는 비워 두고 사람에게 묻는다.
 */
export function authorFromCpa(cpa: string | null | undefined): string | null {
  const s = (cpa ?? '').trim();
  if (!s || s.includes('법인') || s.includes('지정')) return null;
  return s;
}

export interface SetupProposal {
  /** 미리 골라 둘 조서 기준. 모르면 null — 사람이 고른다. */
  auditBasis: AuditBasis | null;
  /** 전기 세팅에서 가져왔는가(그러면 「그대로인가요」로 묻는다). */
  fromPrior: boolean;
  partner: string;
  /** 작성자 기본값. 계약에서 못 찾으면 null. */
  author: string | null;
}

/**
 * 당기 세팅의 첫 제안.
 *  · 조서 기준 — 전기 세팅이 있으면 그 값. 없으면 재무제표가 K-IFRS 일 때만 K-IFRS 로 정할 수 있고,
 *    일반기업이면 일반인지 소규모인지 알 길이 없으니 비워 둔다(감사계약에서 정하는 값이다).
 *  · 검토자 — 전기 세팅의 파트너, 없으면 기본 파트너.
 *  · 작성자 — 감사 매출계약의 담당회계사(사용자 2026-09-25). 전기 값보다 계약이 우선한다.
 */
export function proposeSetup(o: {
  prior?: { auditBasis: AuditBasis; partner: string } | null;
  fsBasis: string;
  contractCpa?: string | null;
}): SetupProposal {
  const auditBasis: AuditBasis | null = o.prior?.auditBasis ?? (o.fsBasis === 'K-IFRS' ? 'K-IFRS' : null);
  return {
    auditBasis,
    fromPrior: !!o.prior,
    partner: o.prior?.partner || DEFAULT_PARTNER,
    author: authorFromCpa(o.contractCpa),
  };
}

/**
 * 이월할 수 있는가 — 1단계는 **같은 기준끼리만** 옮긴다. 기준이 바뀐 해(일반↔소규모)는
 * 조서 구성이 달라 4단계(기준 전환 이월)에서 다룬다. 그 전에는 「양식으로 새로 만들기」를 권한다.
 * 전기 세팅이 없으면(전기 기준을 모르면) 막지 않는다 — 1차 방식 그대로 옮긴다.
 */
export function rollBlockedBy(prior: AuditBasis | null | undefined, current: AuditBasis): string | null {
  if (!prior || prior === current) return null;
  return `전기는 「${AUDIT_BASIS_LABEL[prior]}」, 당기는 「${AUDIT_BASIS_LABEL[current]}」 조서입니다 — 기준이 바뀐 해의 이월은 아직 지원하지 않습니다. 「양식으로 새로 만들기」로 시작하십시오.`;
}

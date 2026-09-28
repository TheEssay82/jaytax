// 2301(재무제표 수준) 위험별 표준 문구 — 「관련 통제 이해」(G)·「전반적인 대응」(H).
//
// 사용자 2026-09-28: 「위험별 "표준문구넣기" 버튼 넣어주세요. 다만 다양한 예가 필요할 것 같습니다. 일단 알티스트 문구로
// 표준문구를 넣되 차후 검토과정에서 예시문구를 추가하도록 합시다.」
// → 위험 종류마다 예시를 **여러 개** 둘 수 있다. 예시를 더하려면 그 종류의 examples 에 한 줄 추가하면 화면에 버튼이 늘어난다.
// 조서번호는 한공회 양식 번호(3500 특수관계자 · 3600 부정 · 3700 계속기업 · 8300 서면진술)다.
import type { AuditBasis } from './gwpSetup';

export interface Phrase {
  /** 버튼 이름 */ label: string;
  /** 이 판단(유의적 Y/N)일 때만. 없으면 둘 다. */ sig?: 'Y' | 'N';
  control: string;
  response: string;
  /** 어디서 온 문구인가 — 「알티스트 FY2026」 */ from: string;
}
export interface RiskKind { key: string; name: string; match: RegExp; examples: Phrase[] }

/** 회계기준별 특수관계자 공시 기준. */
const RP_STD: Record<AuditBasis, string> = {
  'K-IFRS': '기업회계기준서 제1024호',
  일반기업회계기준: '일반기업회계기준 제16장',
  소규모감사기준: '일반기업회계기준 제16장',
};

export const RISK_KINDS: RiskKind[] = [
  {
    key: 'related', name: '특수관계자', match: /특수관계/,
    examples: [{
      label: '표준(알티스트)', sig: 'Y', from: '알티스트 FY2026',
      control: '특수관계자 거래의 식별·승인 절차 질문 및 이사회 승인 관행 확인(2511).',
      response: '경영진에게 특수관계자 목록을 받아 갱신하고, 주주명부·법인등기부·이사회 및 주주총회 의사록·금융거래조회서와 대사하여 누락 여부를 확인함. 특수관계자 채권·채무는 조회하고 거래조건을 검토하며, 정상적인 영업과정을 벗어난 유의적 거래는 계약서·승인 근거·사업상 합리성을 검토함. {특수관계자기준}에 따른 주석 공시의 적정성을 검토함(3500 참조).',
    }],
  },
  {
    key: 'going', name: '계속기업', match: /계속기업|존속/,
    examples: [
      {
        label: '유의적 아님(알티스트)', sig: 'N', from: '알티스트 FY2026',
        control: '경영진의 자금수지 계획 수립·검토 절차 질문(2511).',
        response: '유의적 위험 아님. 감사 기간 전체에 걸쳐 계속기업 가정에 의문을 제기할 사건·상황을 확인하고, 기말감사 시 경영진의 평가와 후속사건을 검토함(3700 참조).',
      },
      {
        label: '유의적 위험(자금조달·상환)', sig: 'Y', from: '알티스트 FY2026 검토 권고',
        control: '경영진의 자금수지 계획 수립·검토 절차 질문(2511).',
        response: '경영진의 향후 12개월 자금수지 계획과 전환사채·차입금 상환 계획을 입수하여 주요 가정의 합리성을 검토하고, 차입약정 위반 여부와 보고기간 후 자금조달 실적을 확인함. 계속기업 관련 불확실성의 주석 공시 적정성을 검토함(3700 참조).',
      },
    ],
  },
  {
    key: 'law', name: '법규 미준수', match: /법률|법규|미준수/,
    examples: [{
      label: '유의적 아님(알티스트)', sig: 'N', from: '알티스트 FY2026',
      control: '법규 준수 관리 절차 질문(2511).',
      response: '유의적 위험 아님. 경영진 질문, 의사록·규제기관 서신 열람, 변호사조회서로 미준수 사례를 확인하고, 경영진 서면진술을 받음(8300 참조).',
    }],
  },
  {
    // 특수관계·법규보다 뒤 — 「특수관계자 … 부정 및 오류」 같은 문구가 앞 종류로 먼저 잡히게.
    key: 'fraud', name: '부정', match: /부정|통제\s*무력화|수기분개/,
    examples: [{
      label: '표준(알티스트)', sig: 'Y', from: '알티스트 FY2026',
      control: '2511 통제환경·2512 위험평가 이해 참조. 경영진이 통제를 무력화할 위험은 통제의 효과성과 관계없이 존재함.',
      response: '업무팀 토의(Kick-off)에서 부정위험을 공유하고 전 과정에 전문가적 의구심을 유지하며, 경험 있는 인력 배정과 감독을 강화함. 경영진의 통제 무력화 위험에 대응하여 ① 분개 테스트(수기·결산·비경상 분개, 기말일 전후 분개), ② 회계추정의 편의 검토(전기 추정치의 사후 검토 포함), ③ 정상적인 영업과정을 벗어난 유의적 거래의 사업상 합리성 평가를 수행함. 감사절차의 성격·시기·범위에 예측 불가능성 요소를 반영함(3600 참조).',
    }],
  },
];

/** 이 위험 문구의 종류 — 위에서부터 첫째로 맞는 것. */
export function kindOfRisk(risk: string): RiskKind | null {
  return RISK_KINDS.find((k) => k.match.test(risk)) ?? null;
}

/** 이 줄에 보일 예시 — 판단(Y/N)이 맞는 것 먼저, 판단을 아직 안 정했으면 모두. */
export function phrasesFor(risk: string, sig: string): Phrase[] {
  const k = kindOfRisk(risk);
  if (!k) return [];
  const fit = k.examples.filter((p) => !p.sig || !sig || p.sig === sig);
  return fit.length ? fit : k.examples;
}

/** 문구 안의 자리 — {특수관계자기준}. */
export function fillPhrase(text: string, basis: AuditBasis | null | undefined): string {
  return text.replace(/\{특수관계자기준\}/g, RP_STD[basis ?? '일반기업회계기준'] ?? RP_STD.일반기업회계기준);
}

// 자동 생성 — scripts/gen-categories.ts. 손으로 고치지 말 것.
export const CATEGORIES = [
  {
    "code": "AUD.AUDIT",
    "team": "감사team",
    "label": "회계감사",
    "defaultUnit": "법인",
    "defaultCycle": "연"
  },
  {
    "code": "AUD.SVC.FILING.CORP",
    "team": "감사team",
    "label": "용역 › 신고(세무조정포함) › 법인세",
    "defaultUnit": "법인",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.FILING.INCOME",
    "team": "감사team",
    "label": "용역 › 신고(세무조정포함) › 소득세",
    "defaultUnit": "개인",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.FILING.TRANSFER",
    "team": "감사team",
    "label": "용역 › 신고(세무조정포함) › 양도세",
    "defaultUnit": "개인",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.FILING.INHERIT",
    "team": "감사team",
    "label": "용역 › 신고(세무조정포함) › 상증세",
    "defaultUnit": "개인",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.FILING.SECURITIES",
    "team": "감사team",
    "label": "용역 › 신고(세무조정포함) › 증권거래세",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.FILING.RECTIFY",
    "team": "감사team",
    "label": "용역 › 신고(세무조정포함) › 경정청구",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.FILING.ETC",
    "team": "감사team",
    "label": "용역 › 신고(세무조정포함) › 기타",
    "needsEtcName": true,
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.VAL.ENTERPRISE",
    "team": "감사team",
    "label": "용역 › 평가 › 기업가치(CGU포함)평가",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.VAL.INTANGIBLE",
    "team": "감사team",
    "label": "용역 › 평가 › 무형자산(영업권·PPA포함)",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.VAL.INHERIT",
    "team": "감사team",
    "label": "용역 › 평가 › 상증세",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.VAL.DERIVATIVE",
    "team": "감사team",
    "label": "용역 › 평가 › 파생상품(옵션포함)",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.VAL.ETC",
    "team": "감사team",
    "label": "용역 › 평가 › 기타",
    "needsEtcName": true,
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.CON.IFRS",
    "team": "감사team",
    "label": "용역 › 회계자문 › IFRS전환",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.CON.STD",
    "team": "감사team",
    "label": "용역 › 회계자문 › K-IFRS 기준서 적용검토",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.CON.CLOSE",
    "team": "감사team",
    "label": "용역 › 회계자문 › 결산지원(PA)",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.CON.ADVISORY",
    "team": "감사team",
    "label": "용역 › 회계자문 › 자문",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.CON.ETC",
    "team": "감사team",
    "label": "용역 › 회계자문 › 기타",
    "needsEtcName": true,
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.CON.ICFR_BUILD",
    "team": "감사team",
    "label": "용역 › 내부회계 › 구축",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.CON.ICFR_PA",
    "team": "감사team",
    "label": "용역 › 내부회계 › 운영지원(PA)",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.DUE.FDD",
    "team": "감사team",
    "label": "용역 › 실사·확인 › 재무실사(약식 포함)",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.DUE.AUP",
    "team": "감사team",
    "label": "용역 › 실사·확인 › 업무감사(합의된 절차)",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.DUE.CERT",
    "team": "감사team",
    "label": "용역 › 실사·확인 › 확인서 발급",
    "defaultCycle": "건"
  },
  {
    "code": "AUD.SVC.DUE.ETC",
    "team": "감사team",
    "label": "용역 › 실사·확인 › 기타",
    "needsEtcName": true,
    "defaultCycle": "건"
  },
  {
    "code": "TAX.BOOK",
    "team": "taxteam",
    "label": "기장",
    "defaultUnit": "사업장"
  },
  {
    "code": "TAX.FILING.VAT",
    "team": "taxteam",
    "label": "신고 › 부가가치세",
    "defaultUnit": "사업장"
  },
  {
    "code": "TAX.FILING.WHT",
    "team": "taxteam",
    "label": "신고 › 원천세(연말정산포함)",
    "defaultUnit": "사업장"
  },
  {
    "code": "TAX.FILING.CORP",
    "team": "taxteam",
    "label": "신고 › 법인세",
    "defaultUnit": "법인"
  },
  {
    "code": "TAX.FILING.INCOME",
    "team": "taxteam",
    "label": "신고 › 소득세",
    "defaultUnit": "개인"
  },
  {
    "code": "TAX.FILING.TRANSFER",
    "team": "taxteam",
    "label": "신고 › 양도소득세",
    "defaultUnit": "개인"
  },
  {
    "code": "TAX.FILING.INHERIT",
    "team": "taxteam",
    "label": "신고 › 상증세",
    "defaultUnit": "개인"
  },
  {
    "code": "TAX.FILING.SECURITIES",
    "team": "taxteam",
    "label": "신고 › 증권거래세"
  },
  {
    "code": "TAX.FILING.RECTIFY",
    "team": "taxteam",
    "label": "신고 › 수정·경정"
  },
  {
    "code": "TAX.FILING.ETC",
    "team": "taxteam",
    "label": "신고 › 기타",
    "needsEtcName": true
  },
  {
    "code": "TAX.CON.RECTIFY",
    "team": "taxteam",
    "label": "컨설팅 › 수정·경정"
  },
  {
    "code": "TAX.CON.BOOK_REVIEW",
    "team": "taxteam",
    "label": "컨설팅 › 기장검토"
  },
  {
    "code": "TAX.CON.WHT_REVIEW",
    "team": "taxteam",
    "label": "컨설팅 › 원천세검토"
  },
  {
    "code": "TAX.CON.VAT_REVIEW",
    "team": "taxteam",
    "label": "컨설팅 › 부가세검토"
  },
  {
    "code": "TAX.CON.ADVISORY",
    "team": "taxteam",
    "label": "컨설팅 › 회계및세무자문"
  },
  {
    "code": "TAX.CON.ETC.RECEIPT",
    "team": "taxteam",
    "label": "컨설팅 › 기타 › 증빙발행",
    "defaultUnit": "사업장"
  },
  {
    "code": "TAX.CON.ETC.ETC",
    "team": "taxteam",
    "label": "컨설팅 › 기타 › 기타",
    "needsEtcName": true
  }
] as const;

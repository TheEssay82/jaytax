// 업무 폴더에서 파일 찾기 — 실제 폴더 이름(2026-09-28 정우철 업무파일 실측)으로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCompany, pickYearFolder, classify, sure, fyOfName } from './gwpFolder';

test('회사 폴더 — 같은 이름, 꼬리(사모투자합자회사·유한회사)를 떼고 품으면 후보, 기억한 짝이 우선', () => {
  const fs = ['알티스트', '알엑스씨', '오큘러스제1호사모투자합자회사', '오큘러스제2호사모투자합자회사', '이니어스블라인드제1호사모투자합자회사', '마크베이스(구 인피니플럭스)'];
  assert.equal(matchCompany(fs, '알티스트').pick, '알티스트');
  assert.equal(matchCompany(fs, '(주)알엑스씨').pick, '알엑스씨');
  assert.equal(matchCompany(fs, '오큘러스제1호').pick, '오큘러스제1호사모투자합자회사');
  assert.equal(matchCompany(fs, '마크베이스').pick, '마크베이스(구 인피니플럭스)');
  assert.equal(matchCompany(fs, '이니어스제1호블라인드').pick, '이니어스블라인드제1호사모투자합자회사');   // 글자 순서만 다름
  assert.equal(matchCompany(fs, '없는회사').pick, null);
  assert.equal(matchCompany(fs, '이니어스제1호블라인드', '이니어스블라인드제1호사모투자합자회사').pick, '이니어스블라인드제1호사모투자합자회사');
});

test('연도 폴더 — 회계감사 > 기말·개별감사, 중간·실사·평가는 아니다', () => {
  assert.equal(pickYearFolder(['000_계약관리', '2024_회계감사', '2025_회계감사'], 2025), '2025_회계감사');
  assert.equal(pickYearFolder(['2025_중간감사', '2025_기말감사'], 2025), '2025_기말감사');
  assert.equal(pickYearFolder(['2025_개별감사'], 2025), '2025_개별감사');
  assert.equal(pickYearFolder(['2025_트리플라_공정가치업데이트용역'], 2025), null);
});

test('파일 이름의 해 — FY25 · FY2025 · FY2512 · FY251231 · FY20251231', () => {
  for (const n of ['a_FY25.xlsx', 'a_FY2025_260311_Final.dsd', 'WTB_a_FY2512_260217.xlsx', 'WTB_a_FY251231_260225_Final.xlsx', 'x_FY20251231.xlsx']) assert.equal(fyOfName(n), 2025, n);
  assert.equal(fyOfName('감사보고서25_260310.dsd'), null);
});

test('종류별 후보 — 삭제 폴더·bak·PBC 는 빼고, 기말·Final·해가 맞는 것', () => {
  const f = classify([
    '000_A파일/기말감사일반조서_알티스트_FY25.xlsx',
    '000_A파일/8400_공시사항점검표 (일반기준용)_알티스트_FY2025.xlsx',
    '400_보고서/감사보고서_알티스트_FY2025_260311_Final.dsd',
    '400_보고서/감사보고서_알티스트_FY2025_260311_Final.dsd.bak',
    '400_보고서/기업개황정보_알티스트_FY2025_20260217.dsd',
    '600_정산표/WTB_알티스트_FY251231_260225_Final.xlsx',
    '600_정산표/삭제/WTB_알티스트_FY241231_250219_Final.xlsx',
    '600_정산표/WTB_개별_알티스트_FY25_중간_251223.xlsx',
    '900_PBC_기말감사/3. 더존백업파일 및 재무제표/25년 결산정산표(최종)_260209_Final.xlsx',
  ], 2025);
  assert.equal(sure(f.일반조서)?.name, '기말감사일반조서_알티스트_FY25.xlsx');
  assert.equal(f.감사보고서.length, 1);
  assert.equal(sure(f.감사보고서)?.name, '감사보고서_알티스트_FY2025_260311_Final.dsd');
  assert.equal(sure(f.정산표)?.name, 'WTB_알티스트_FY251231_260225_Final.xlsx');
  assert.equal(f.정산표.length, 2);
});

test('애매하면 고르지 않는다 — 나눈 조서(1000·2000), 별도·연결은 별도', () => {
  const f = classify(['A File/K-IFRS_일반조서(1000)_윤성_FY2025.xlsx', 'A File/K-IFRS_일반조서(2000)_윤성_FY2025.xlsx',
    '400/별도감사보고서_윤성_25년기말_완_260323.dsd', '400/연결감사보고서_윤성_25년기말_완_260323.dsd'], 2025);
  assert.equal(sure(f.일반조서), null);
  assert.equal(sure(f.감사보고서)?.name, '별도감사보고서_윤성_25년기말_완_260323.dsd');
  const w = classify(['2.기말감사/700_정산표/별도WTB_윤성에프앤씨_FY25Q4_v4_0313_세무조정반영.xlsx', '2.기말감사/510_연결조서및정산표/연결정산표_(주)윤성에프앤씨_FY2025_4분기_20260314.xlsx'], 2025);
  assert.equal(sure(w.정산표)?.name, '별도WTB_윤성에프앤씨_FY25Q4_v4_0313_세무조정반영.xlsx');
});

test('이름으로 못 알아보면 같은 확장자 파일을 모두 후보로 — 고르지는 않는다', () => {
  const f = classify(['감사/조서_최종.xlsx', '감사/보고서.dsd', '감사/결산.xlsx'], 2025);
  assert.equal(f.감사보고서.length, 1);
  assert.equal(sure(f.감사보고서), null);
  assert.deepEqual(f.일반조서.map((c) => c.name).sort(), ['결산.xlsx', '조서_최종.xlsx']);
  assert.equal(sure(f.일반조서), null);
});

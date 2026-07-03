// 청구서 본문(인쇄용) — Step5와 청구기록 PDF에서 공용. 저장된 기록(BillingRecord)이나 위저드 상태(WizardState)
//  어느 쪽이든 받아 현재 수수료 설정으로 재계산해 렌더한다. draft=true면 '작성중(미확정)' 표시를 붙인다.
import type { AppConfig, WizardState } from '../../types';
import { calcS, won, pct, dt } from '../../lib/calc';

export default function InvoiceDocument({ S, config, draft }: { S: WizardState; config: AppConfig; draft?: boolean }) {
  const c = calcS(S, config);
  const yr = S.fiscalYear;
  const taxType = S.bizType === '법인' ? '법인세' : '종합소득세';
  const payStr = S.payMonth ? `${S.payMonth}월 ${S.payDay}일` : S.payDay ? `${S.payDay}일` : '';

  return (
    <div className="inv" id="inv-body">
      {draft && <div className="inv-draft">※ 작성중(미확정) 청구서 — 기장팀장 확정 전입니다.</div>}
      <div className="inv-title">청 구 서</div>
      <div className="inv-addr">
        인덕회계법인 | 서울시 영등포구 국회대로70길19 대하빌딩 6층 609호(07238) | 02-782-9960
      </div>
      <div style={{ marginBottom: 11 }}>
        <div className="imrow">
          <span className="iml">회사명</span>
          <span>: {S.companyName || '(미입력)'}</span>
        </div>
        <div className="imrow">
          <span className="iml">발송일</span>
          <span>: {dt(S.issuedDate)}</span>
        </div>
        <div className="imrow">
          <span className="iml">수신</span>
          <span>: {S.repName || '(미입력)'} 대표님</span>
        </div>
        <div className="imrow">
          <span className="iml">제목</span>
          <span>: {yr}년 귀속 결산 및 세무조정</span>
        </div>
      </div>
      <div className="inv-body">
        &nbsp;&nbsp;1. {S.bizType === '법인' ? '귀사' : '귀하'}의 사업이 무한히 번성하시기를 기원드립니다.
        <br />
        &nbsp;&nbsp;2. 지난 <strong>{yr}년</strong> 귀속 <strong>{taxType}</strong> 신고를 무사히 종료할 수
        있도록 협조해 주신 점 깊이 감사드립니다. 아래의 산출근거와 같이 결산 및 조정수수료를 청구하오니 궁금하신
        부분 언제든지 문의주시기 바라며,{payStr ? <strong> {payStr}</strong> : ''}까지 송금하여 주실 것을
        부탁드립니다.
      </div>
      <strong style={{ fontSize: 12 }}>▣ 결산 및 조정수수료 산출 근거</strong>
      <table className="itbl">
        <tbody>
          <tr className="ihdr">
            <td colSpan={5}>구 분</td>
            <td>
              {yr}년 귀속
              <br />
              결산 및 신고조정수수료
            </td>
            <td>비 고</td>
          </tr>
          <tr>
            <td colSpan={5}>매 출 액 (수 입 금 액)</td>
            <td className="ir">{won(c.rev)}</td>
            <td className="ic">(사업장이 여러 곳인 경우 가장 큰 사업장 기준)</td>
          </tr>
          <tr>
            <td rowSpan={14} className="ic-v" style={{ width: 20 }}>
              산 출 내 역
            </td>
            <td colSpan={2}>① 기본보수</td>
            <td colSpan={2}></td>
            <td className="ir">{won(c.baseFee)}</td>
            <td className="ic"></td>
          </tr>
          <tr>
            <td colSpan={2}>② 규모가산 (매출액)</td>
            <td colSpan={2}></td>
            <td className="ir">{won(c.scale)}</td>
            <td className="ic"></td>
          </tr>
          <tr className="itotA">
            <td colSpan={2}>A) 기본업무보수</td>
            <td colSpan={2}></td>
            <td className="ir">{won(c.A)}</td>
            <td className="ic"></td>
          </tr>
          <tr>
            <td colSpan={2}>③ 성실신고수수료</td>
            <td colSpan={2}></td>
            <td className="ir">{won(c.modelFee)}</td>
            <td className="ic">{c.modelFee ? '' : '해당사항없음'}</td>
          </tr>
          <tr>
            <td colSpan={2}>④ 기장 및 결산업무</td>
            <td className="ic">{pct(c.r4)}</td>
            <td></td>
            <td className="ir">{won(c.f4)}</td>
            <td className="ic">기본기장업무 외의 결산업무가 추가되는 경우</td>
          </tr>
          <tr>
            <td colSpan={2}>⑤ 원가계산 업무</td>
            <td className="ic">{pct(c.r5)}</td>
            <td></td>
            <td className="ir">{won(c.f5)}</td>
            <td className="ic">제조원가 및 용역원가 별도작성시 가산</td>
          </tr>
          <tr>
            <td colSpan={2}>⑥ 세무검토 및 기타 자문업무</td>
            <td className="ic">{pct(c.r6)}</td>
            <td></td>
            <td className="ir">{won(c.f6)}</td>
            <td className="ic">세무조정검토 및 기타 자문업무 수행시 가산</td>
          </tr>
          <tr className="itotB">
            <td colSpan={2}>B) 추가업무보수</td>
            <td colSpan={2}></td>
            <td className="ir">{won(c.Btot)}</td>
            <td className="ic"></td>
          </tr>
          <tr>
            <td colSpan={2}>⑦ 증빙서류 발급 등의 업무</td>
            <td colSpan={2}>{S.otherContent || ''}</td>
            <td className="ir">{won(c.f7)}</td>
            <td className="ic">증빙서 발급 및 기타 제반사정 가감</td>
          </tr>
          <tr className="itotC">
            <td colSpan={2}>C) 보수총계 (A+B+⑦)</td>
            <td colSpan={2}></td>
            <td className="ir">{won(c.C)}</td>
            <td className="ic">천원이하 단위 절사</td>
          </tr>
          <tr>
            <td colSpan={2}>⑧ 할인금액</td>
            <td colSpan={2}></td>
            <td className="ir">{c.disc ? '- ' + won(c.disc) : '0원'}</td>
            <td className="ic">{S.discContent || ''}</td>
          </tr>
          <tr>
            <td colSpan={2}>⑨ 협의조정금액</td>
            <td colSpan={2}></td>
            <td className="ir">{c.penFee ? '- ' + won(c.penFee) : '0원'}</td>
            <td className="ic">{S.penaltyContent || ''}</td>
          </tr>
          <tr className="itotD">
            <td colSpan={2}>D) 총 보수 합계 (C-⑧-⑨)</td>
            <td colSpan={2}></td>
            <td className="ir">{won(c.D)}</td>
            <td className="ic"></td>
          </tr>
          <tr>
            <td colSpan={2}>⑩ 부가가치세 (VAT)</td>
            <td className="ic">10%</td>
            <td></td>
            <td className="ir">{won(c.VAT)}</td>
            <td className="ic"></td>
          </tr>
          <tr className="igrand">
            <td colSpan={5}>청 구 금 액</td>
            <td className="ir">{won(c.grand)}</td>
            <td className="ic">(VAT 포함)</td>
          </tr>
        </tbody>
      </table>
      <div className="inv-sign">인덕회계법인 &nbsp; 정우철 · 송현주 회계사 드림</div>
      <div className="inv-bank">
        <p>■ 입금계좌 : 신한은행 [ {S.bankAccount || ' '.repeat(16)} ] &nbsp;&nbsp; 예금주: 인덕회계법인</p>
        <p style={{ marginTop: 3, fontSize: 10, color: '#666' }}>
          ■ {S.bizType === '법인' ? '법인세 및 지방소득세' : '종합소득세 및 지방소득세'}는 납부서에 명기된
          날짜까지 가까운 은행 또는 우체국에 납부하시기 바랍니다.
        </p>
      </div>
    </div>
  );
}

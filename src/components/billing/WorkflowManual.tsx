// 세금계산서 발행 업무 매뉴얼 — 자리별로 무엇을 언제 하는가.
//
// 화면은 잘 만들어 두어도 "그래서 내가 뭘 먼저 하지"가 남는다. 특히 이 일은
// 세 사람이 이어 달린다 — 담당직원이 고치고, 회계사가 요청하고, 김민섭이 발행한다.
// 그래서 **자기 자리만 펼쳐 읽을 수 있게** 셋으로 나눠 적었다.
import { useState } from 'react';
import { useEscape } from '../../lib/useEscape';
import { FINAL_APPROVER, CHECKERS, ISSUE_DAY } from '../../lib/invoiceMonthApi';

type Role = 'approver' | 'staff' | 'cpa';

const TABS: { key: Role; label: string; who: string }[] = [
  { key: 'approver', label: `📮 ${FINAL_APPROVER} (발행 담당)`, who: '세금계산서를 실제로 발행하는 사람' },
  { key: 'staff', label: '🧑‍💻 taxteam 담당직원', who: `${CHECKERS.join('·')}` },
  { key: 'cpa', label: '👔 담당 회계사 (감사팀)', who: '감사·용역 건을 요청하는 사람' },
];

export function WorkflowManual({ initial = 'approver', onClose }: {
  initial?: Role;
  onClose: () => void;
}) {
  useEscape(onClose);
  const [tab, setTab] = useState<Role>(initial);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 70,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 880, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          📖 세금계산서 발행 업무 매뉴얼
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'btn-p' : 'btn-sm'} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginBottom: 10 }}>
          {TABS.find((t) => t.key === tab)?.who}
        </div>

        {tab === 'approver' && <Approver />}
        {tab === 'staff' && <Staff />}
        {tab === 'cpa' && <Cpa />}

        <div className="alert-i" style={{ fontSize: 'var(--fs-1)', marginTop: 12 }}>
          <b>공통으로 기억할 것</b>
          <br />· <b>jaytax는 세금계산서를 발행하지 않습니다.</b> 발행은 인덕 ERP에서 하고, jaytax는
          <b> 요청을 모으고 결과를 대사</b>합니다.
          <br />· <b>취소</b>는 "요청을 없던 일로", <b>수정발행</b>은 "이미 나간 세금계산서를 고침"입니다. 서로 다릅니다.
          <br />· 금액은 어디서나 <b>공급가액(부가세 별도)</b>이 기준이고, 미수금만 <b>부가세 포함</b>입니다.
        </div>
      </div>
    </div>
  );
}

// ── 김민섭 ─────────────────────────────────────────────
function Approver() {
  return (
    <>
      <Lead>
        한 달을 여는 사람이자 닫는 사람입니다. 매달 <b>{ISSUE_DAY}일</b>이 작성일(발행기준일)입니다.
        {ISSUE_DAY}일 전에 열어 두고, 담당자 확인을 받은 뒤 등록하고, ERP에서 발행한 뒤 닫습니다.
      </Lead>

      <H>taxteam — 매달 하는 일</H>
      <Step n="1" t={`${ISSUE_DAY}일 전, 그 달을 연다`} where="발행요청 · taxteam">
        <b>[📂 당월 전개 + 확인요청]</b> 한 번이면 됩니다. <b>전월 세금계산서가 그대로 복사</b>되어
        ① 청구예정이 되고, {CHECKERS.join('·')}에게 확인 알림이 갑니다.
        <br />엑셀에서 전월 열을 복사해 붙이던 그 일을 대신하는 것입니다. 계약에서 새로 계산하지 않습니다.
        <Tip>잘못 열었으면 <b>[↺ 이 달 초기화]</b>로 되돌립니다. 발행완료된 건이 있으면 막힙니다.</Tip>
      </Step>
      <Step n="2" t="담당자 3인의 확인을 기다린다">
        이름표가 <b>✓ 초록</b>이면 확인 완료, <b>○ 회색</b>이면 아직입니다.
        <b> ⚠️ 노랑</b>은 확인해 놓고 그 뒤에 또 고쳤다는 뜻이니 다시 봐야 합니다.
        <br />이름표 옆에 그 사람이 무엇을 했는지 요약이 붙습니다 — <code>수정 3 · 추가 1 · 삭제 2</code>.
        <b> [이번 달 변경 이력]</b>을 펼치면 누가 어느 거래처를 어떻게 고쳤는지 한 표로 봅니다.
      </Step>
      <Step n="3" t="발행요청으로 등록한다">
        ① 청구예정에서 <b>[보이는 건 전체선택]</b> → <b>[발행요청 등록]</b>.
        등록한 건은 ①에서 사라지고 ② 발행요청 목록으로 넘어갑니다.
        <Tip>확인이 덜 된 사람이 있으면 누구인지 짚어 줍니다. 그래도 진행할 수는 있습니다.</Tip>
      </Step>
      <Step n="4" t="ERP에서 발행하고, 대사한다" where="ERP 발행내역 대사">
        ② 목록대로 인덕 ERP에서 발행합니다. 그 뒤 ERP 수집기로 받은 <b>거래전표</b>를 올려
        우리 요청과 맞춰 봅니다. 어긋나면 그 화면의 <b>[도움말]</b>에 경우별 처리법이 있습니다.
      </Step>
      <Step n="5" t="발행완료로 닫는다">
        ② 목록에서 <b>[요청 전체선택]</b> → 발행일을 넣고 <b>[발행완료 처리]</b>.
        <br /><b>여기가 중요합니다</b> — 발행완료로 바꿔야 그 금액이 <b>미수금(채권)</b>으로 잡힙니다.
        요청 상태로 두면 매출·미수금이 그만큼 비어 보입니다.
      </Step>

      <H>감사팀 — 요청이 올라오면</H>
      <Step n="6" t="알림을 받고 발행한다" where="발행요청 · 감사팀">
        회계사가 요청하면 알림이 옵니다. <b>③ 처리 중</b>이 발행 대기 목록입니다.
        ERP에서 발행한 뒤 발행일을 넣고 <b>[발행완료 처리]</b> — 요청한 회계사에게 회신 알림이 갑니다.
        발행된 건은 <b>④ 발행 이력</b>으로 넘어갑니다.
      </Step>

      <H>달마다 한 번 더</H>
      <Step n="7" t="원장·대장을 올린다" where="수금·미수금">
        ERP에서 받은 <b>부서별원장</b>(입금)과 <b>기간 미수금대장</b>(건별 잔액)을 팀별로 올립니다.
        올린 달은 <b>[올린 원장]</b>·<b>[📒 미수금대장]</b>에 남으니 빠뜨린 달이 보입니다.
        <br />대장을 올리면 <b>미수금 나이</b>가 추정이 아니라 실제 발행일로 계산됩니다.
      </Step>
      <Step n="8" t="6개월 넘은 미수금을 알린다" where="수금·미수금 › 미수금 나이">
        <b>[🔔 담당에게 알림]</b> — 180일을 넘긴 건을 담당회계사·담당직원에게 보냅니다.
        같은 달에 같은 거래처로 두 번 가지 않습니다.
      </Step>
    </>
  );
}

// ── taxteam 담당직원 ────────────────────────────────────
function Staff() {
  return (
    <>
      <Lead>
        알림을 받으면 <b>내가 맡은 곳만</b> 보고 고치면 됩니다. 다 보지 않아도 됩니다.
        고친 내용은 자동으로 기록되니 따로 보고하지 않아도 됩니다.
      </Lead>

      <Step n="1" t="알림을 받고 들어간다" where="발행요청 · taxteam">
        매달 {FINAL_APPROVER}가 그 달을 열면 알림이 옵니다. ① 청구예정에 <b>전월 세금계산서가 그대로</b> 들어와 있습니다.
      </Step>
      <Step n="2" t="내 것만 추린다">
        <b>[내 담당만]</b>을 켜면 담당직원이 나인 건만 남습니다. 확인 버튼 옆에 <b>내 담당 N건 · 금액</b>이 보입니다.
      </Step>
      <Step n="3" t="고치고, 지우고, 더한다">
        표에서 <b>그 자리에서</b> 고칩니다 — <b>금액</b>은 칸에 바로, <b>담당직원</b>은 드롭다운, <b>적요</b>도 그 자리에서.
        <br />· 그만둔 곳: 줄 끝의 <b>[−]</b>로 지웁니다.
        <br />· 새로 시작한 곳: <b>[🔍 매출계약 대사]</b>에서 <b>계약에만</b>으로 뜨는 건을 <b>[＋ 청구예정에 추가]</b>.
        <br />· 금액이 바뀐 곳: 대사 창의 <b>금액다름</b>에서 <b>[계약금액으로 맞춤]</b>, 이번 달만 다르면 표에서 직접.
        <Tip>
          <b>매출계약은 참고자료이고 기준이 아닙니다.</b> 계약이 최신이 아닐 수 있으니
          "계약이 이러니 이대로"가 아니라 <b>실제로 청구할 금액</b>을 넣으세요.
        </Tip>
      </Step>
      <Step n="4" t="확인을 누른다">
        <b>[✅ 확인했습니다]</b>. <b>고칠 게 없어도 눌러야 합니다</b> — 안 누르면 봤는지 알 수 없습니다.
        버튼에 내가 한 일이 요약돼 붙습니다(<code>수정 3 · 추가 1 · 삭제 2</code>).
        <Tip>확인한 뒤에 또 고치면 이름표가 <b>⚠ 노랑</b>으로 바뀝니다. 그러면 <b>다시 눌러</b> 주세요.</Tip>
      </Step>
      <Step n="5" t="그 뒤는 하지 않는다">
        발행요청 등록·발행완료는 {FINAL_APPROVER}의 몫입니다. 확인까지가 담당직원의 일입니다.
      </Step>

      <H>덧붙여</H>
      <Step n="＋" t="담당이 바뀌었다면">
        담당직원 칸을 눌러 바꿉니다. 이번 달만 대신한 것이면 그대로 저장하고,
        <b> 앞으로도 내가 담당</b>이면 창의 체크를 켜세요 — <b>매출계약의 담당이 그 달부터 바뀌어</b>
        다음 달부터 저절로 내 이름으로 옵니다. 지난 달 실적은 그대로 남습니다.
      </Step>
      <Step n="＋" t="둘이 나눠 한 일이면">
        같은 창에서 <b>[＋ 공동담당]</b>으로 비율을 나눕니다(합 100%). 매출통계가 그 비율대로 나뉩니다.
      </Step>
    </>
  );
}

// ── 감사팀 담당 회계사 ──────────────────────────────────
function Cpa() {
  return (
    <>
      <Lead>
        감사·용역은 계약금·중도금·잔금이 <b>건별로</b> 생깁니다. 달로 묶지 않고,
        <b> 청구할 때가 되면 알림</b>이 옵니다. 요청까지가 회계사의 일이고, 발행은 {FINAL_APPROVER}가 합니다.
      </Lead>

      <Step n="1" t="알림을 받는다" where="발행요청 · 감사팀">
        매출계약의 <b>분할회차 청구기한</b>이 지나면 ① 제안에 올라오고 담당 회계사에게 알림이 갑니다.
        <Tip>
          알림이 오려면 <b>매출계약에 분할회차와 청구기한이 등록</b>돼 있어야 합니다.
          등록해 두지 않으면 제안이 뜨지 않으니, 계약할 때 회차·기한을 넣어 두세요.
        </Tip>
      </Step>
      <Step n="2" t="제안은 알림일 뿐 — 고쳐서 넘긴다">
        고른 뒤 <b>[✅ 확인 · 발행요청]</b>을 누르면 창이 열립니다. 여기서
        <b> 작성일(발행기준일)·금액·매출계정·구분·적요</b>를 고칩니다.
        <br /><b>작성일이 실제 세금계산서 날짜입니다.</b> 계약의 청구기한이 아니라 <b>지금 발행할 날</b>을 넣으세요 —
        기한이 한참 지난 건을 그대로 넘기면 몇 달 전 날짜로 나갑니다.
        <Tip>60일 넘게 지난 건은 창에서 따로 짚어 줍니다.</Tip>
      </Step>
      <Step n="3" t="계약에 없는 건은 직접 적는다">
        <b>② 건별 발행요청</b>에서 한 줄 적습니다 — 거래처·매출계정·구분·공급가액·적요·작성일.
        등록하면 {FINAL_APPROVER}에게 바로 알림이 갑니다.
      </Step>
      <Step n="4" t="이미 ERP로 발행한 회차는 닫는다">
        제안에 뜨는데 이미 ERP에서 발행했다면 <b>[이미 청구함 · 제안에서 빼기]</b>.
        계약의 그 회차를 '청구했음'으로 닫아 다시 뜨지 않게 합니다.
      </Step>
      <Step n="5" t="발행 결과를 확인한다">
        {FINAL_APPROVER}가 발행완료하면 <b>회신 알림</b>이 옵니다.
        그 건은 <b>③ 처리 중</b>에서 <b>④ 발행 이력</b>으로 넘어갑니다(기본 최근 3개월, 기간을 넓힐 수 있습니다).
      </Step>
      <Step n="＋" t="잘못 나간 세금계산서는">
        <b>[➖ 수정발행 (−/+)]</b> — 되돌릴 건을 골라 열면 금액이 채워집니다.
        금액은 <b>양수로</b> 넣고 방향만 고르세요. 미수금과 매출통계에서 그만큼 빠집니다(또는 늘어납니다).
      </Step>
    </>
  );
}

// ── 작은 조각들 ─────────────────────────────────────────
function Lead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 'var(--fs-2)', lineHeight: 1.8, background: '#fdfaf3', border: '1px solid var(--rule)',
      borderRadius: 6, padding: '8px 10px', marginBottom: 10,
    }}>{children}</div>
  );
}
function H({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)', margin: '14px 0 6px',
      borderBottom: '2px solid var(--rule)', paddingBottom: 3,
    }}>{children}</div>
  );
}
function Step({ n, t, where, children }: {
  n: string; t: string; where?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 9 }}>
      <span style={{
        flexShrink: 0, width: 22, height: 22, borderRadius: 11, background: 'var(--navy)', color: '#fff',
        fontSize: 'var(--fs-1)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{n}</span>
      <div style={{ fontSize: 'var(--fs-1)', lineHeight: 1.85 }}>
        <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>{t}</b>
        {where && (
          <span style={{
            marginLeft: 5, fontSize: 'var(--fs-0)', color: '#5B21B6', background: '#EDE9FE',
            border: '1px solid #C4B5FD', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap',
          }}>{where}</span>
        )}
        <div style={{ color: 'var(--ink-2)' }}>{children}</div>
      </div>
    </div>
  );
}
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 3, fontSize: 'var(--fs-1)', color: '#7a5', background: '#fbfdf7',
      borderLeft: '3px solid #cfe0b8', padding: '3px 8px',
    }}>{children}</div>
  );
}

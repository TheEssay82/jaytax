// 회계기준서검토 — 회계기준(K-IFRS 등) 근거 검색 UI가 들어갈 자리.
// 현재는 자리표시. 근거 DB(accounting_standards) 적재 + search-standards Edge Function 연결 후 검색 UI로 대체 예정.
export default function StandardsTab() {
  return (
    <div className="card">
      <div className="chdr">📚 회계기준서검토</div>
      <div className="alert-i" style={{ lineHeight: 1.7 }}>
        회계기준서(K-IFRS·일반기업회계기준) 근거 검색 기능을 준비 중입니다.
        <br />
        원문 적재(파일럿: K-IFRS 제1115호)와 검색 함수 연결이 끝나면 이 화면에서 질의→관련 문단 검색이 가능해집니다.
      </div>
    </div>
  );
}

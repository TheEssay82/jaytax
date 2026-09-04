// 수금·미수금 › 미수금대장 올리기.
//
// 미수금 나이는 이 표에서 나온다 — ERP 부서별 미수금대장은 건별로
// invoiceNo(= 거래전표번호, 발행일이 그 안에 있다)와 잔금을 들고 있다.
// 대장이 없으면 화면은 추정(FIFO)으로 떨어지므로, 어느 달까지 올렸는지도 함께 보여 준다.
import { useState } from 'react';
import type { ArRead, ArUpload } from '../../lib/arLedgerApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const teamLabel = (t: string) => (t === 'taxteam' ? '기장24팀' : '2본부5팀');

export interface PlaceOption { id: string | null; entityId: string; label: string }

export function AgingLedgerBox({
  ym, team, uploads, preview, busy, canWrite, unmatched, placeOpts,
  onFile, onCancel, onSave, onAssign, onExclude,
}: {
  ym: string;
  team: string;
  uploads: ArUpload[];
  preview: (ArRead & { fileName: string }) | null;
  busy: boolean;
  canWrite: boolean;
  unmatched: { clientName: string; cpa: string; count: number; balance: number; excluded: boolean }[];
  placeOpts: { id: string; entityId: string; label: string }[];
  onFile: (f: File) => void;
  onCancel: () => void;
  onSave: () => void;
  onAssign: (clientName: string, opt: { id: string; entityId: string }) => void;
  onExclude: (clientName: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const up = uploads.find((u) => u.ym === ym && u.team === team);
  const mine = uploads.filter((u) => u.team === team).map((u) => u.ym).sort();

  return (
    <div style={{ border: '1px solid #c9b98a', borderRadius: 8, background: '#fdfaf3', padding: '8px 10px', marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>📒 미수금대장</b>
        {up ? (
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--good)' }}>
            {ym} {teamLabel(team)} 올림 — {up.rowCount}건 · 잔금 {won(up.balanceTotal)}
            {' · '}{up.uploadedAt.slice(0, 10)}{up.uploadedBy && ` ${up.uploadedBy}`}
          </span>
        ) : (
          <span style={{ fontSize: 'var(--fs-1)', color: '#a15' }}>
            {ym} {teamLabel(team)} 대장이 아직 없습니다 — 나이가 <b>추정</b>으로 계산됩니다.
          </span>
        )}
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
          {mine.length ? `올린 달: ${mine[0]}${mine.length > 1 ? `~${mine[mine.length - 1]}` : ''} (${mine.length}개월)` : ''}
        </span>
        {canWrite && (
          <label className="btn-sm" style={{ marginLeft: 'auto', cursor: busy ? 'default' : 'pointer' }}>
            {up ? '다시 올리기' : '＋ 대장 올리기'}
            <input type="file" accept=".xls,.xlsx" style={{ display: 'none' }} disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
          </label>
        )}
      </div>
      <div style={{ fontSize: 'var(--fs-0)', color: '#998', marginTop: 3 }}>
        인덕 ERP ▸ <b>기간 미수금대장</b> ▸ 기간 {ym}-01 ~ 말일 ▸ 조회 ▸ 엑셀.
        건별 invoiceNo(전표번호)에 <b>발행일</b>이 들어 있어, 이걸 올리면 미수금 나이를 추정 없이 잽니다.
      </div>

      {preview && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--rule)', paddingTop: 8 }}>
          <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)' }}>
            읽었습니다 — {preview.rows.length}건 · 잔금 {won(preview.balanceTotal)}
          </div>
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', margin: '4px 0 8px', lineHeight: 1.7 }}>
            {preview.fileName}{preview.period && ` · ${preview.period}`}
            <br />기초이월 {won(preview.openingTotal)} + 청구 {won(preview.billedTotal)} − 입금 {won(preview.paidTotal)}
            {' ≒ '}<b>잔금 {won(preview.balanceTotal)}</b>
            <br />상호로 우리 거래처에 붙입니다. 못 붙은 것은 아래에 따로 나옵니다.
          </div>
          {up && (
            <div className="alert-w" style={{ fontSize: 'var(--fs-1)' }}>
              ⚠️ {ym} {teamLabel(team)} 대장이 이미 올라와 있습니다 ({up.rowCount}건 · {won(up.balanceTotal)}).
              저장하면 <b>그 달 대장을 지우고 이 파일로 바꿉니다</b>.
            </div>
          )}
          {!!preview.period && !preview.period.includes(ym) && (
            <div className="alert-w" style={{ fontSize: 'var(--fs-1)' }}>
              ⚠️ 대장의 조회기간이 고른 달(<b>{ym}</b>)과 달라 보입니다 — <b>{preview.period}</b>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-p" disabled={busy} onClick={onSave}>저장하고 반영하기</button>
            <button className="btn-sm" disabled={busy} onClick={onCancel}>취소</button>
          </div>
        </div>
      )}

      {unmatched.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button className="btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? '▾' : '▸'} 거래처를 못 붙인 대장 {unmatched.filter((u) => !u.excluded).length}곳
            {' · '}{won(unmatched.filter((u) => !u.excluded).reduce((s, u) => s + u.balance, 0))}
          </button>
          {open && (
            <>
              <div style={{ fontSize: 'var(--fs-0)', color: '#998', margin: '4px 0' }}>
                대장은 <b>그 부서 전체</b>라 우리 담당이 아닌 건이 섞입니다(회계사 이름을 보세요).
                우리 거래처면 <b>연결</b>하고, 남의 건이면 <b>제외</b>합니다 — 제외한 것은 나이 분석에서 빠집니다.
              </div>
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
                  <thead>
                    <tr><th>대장의 거래처</th><th>회계사</th><th className="r">건수</th><th className="r">잔금</th>
                      <th style={{ minWidth: 300 }}>우리 거래처에 연결</th><th></th></tr>
                  </thead>
                  <tbody>
                    {unmatched.map((u) => (
                      <tr key={u.clientName} style={{ opacity: u.excluded ? 0.5 : 1 }}>
                        <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{u.clientName}</td>
                        <td>{u.cpa}</td>
                        <td className="r">{u.count}</td>
                        <td className="r" style={{ fontWeight: 700 }}>{won(u.balance)}</td>
                        <td>
                          {canWrite && !u.excluded && (
                            <span style={{ display: 'flex', gap: 4 }}>
                              <input list="ar-places" value={choice[u.clientName] ?? ''} placeholder="코드·상호로 찾기"
                                onChange={(e) => setChoice((p) => ({ ...p, [u.clientName]: e.target.value }))}
                                style={{ flex: 1, fontSize: 'var(--fs-1)' }} />
                              <button className="btn-p" disabled={busy || !placeOpts.some((o) => o.label === (choice[u.clientName] ?? ''))}
                                onClick={() => {
                                  const o = placeOpts.find((x) => x.label === choice[u.clientName]);
                                  if (o) onAssign(u.clientName, o);
                                }}>연결</button>
                            </span>
                          )}
                        </td>
                        <td>
                          {canWrite && (
                            <button className={u.excluded ? 'btn-sm' : 'btn-sm btn-sm-del'} disabled={busy}
                              onClick={() => onExclude(u.clientName, !u.excluded)}>
                              {u.excluded ? '되돌리기' : '제외'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id="ar-places">
                  {placeOpts.map((o) => <option key={o.id} value={o.label} />)}
                </datalist>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

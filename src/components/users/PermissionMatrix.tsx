// 사용자/계정관리 › 권한 현황 (최고관리자 전용)
//
// "이 메뉴를 기장팀원이 볼 수 있었나?"를 매번 코드에서 찾아보게 되는 게 문제였다.
// 그래서 **실제로 화면이 쓰는 규칙**(lib/menu.ts · lib/roles.ts)을 그대로 읽어 표로 그린다 —
// 여기 적힌 설명이 아니라 그 규칙이 원본이므로, 메뉴나 권한을 고치면 이 표가 저절로 따라온다.
import { useMemo, useState } from 'react';
import {
  ROLES, ROLE_LABELS, can,
  type Capability, type Role,
} from '../../lib/roles';
import { MENU_GROUPS, ICON_ITEMS, menuAllowed, groupAllowed, type MenuItem } from '../../lib/menu';
import type { UserProfile } from '../../lib/usersApi';

/** 권한 항목이 무엇을 뜻하는지 — 코드의 주석을 사람 말로. */
const CAP_LABELS: Record<Capability, string> = {
  saveInvoice: '청구서 임시저장(본인 초안)',
  finalizeInvoice: '청구서 확정',
  viewClients: '거래처관리 메뉴 접근',
  manageClients: '거래처 등록·수정·삭제·일괄',
  manageTargets: '청구대상 확정',
  deleteBilling: '청구기록 삭제',
  viewAllBilling: '청구기록 전체 조회',
  viewAllStats: '통계 전체 조회',
  changeSettings: '수수료 설정 변경',
  manageUsers: '사용자/계정 관리',
  viewAiUsage: 'AI 사용량 열람',
  finalizeConsult: '상담기록 확정',
  viewDispatch: '발송요청 처리 조회',
  processDispatch: '발송요청 처리(쓰기)',
};
const CAPS = Object.keys(CAP_LABELS) as Capability[];

const O = <span style={{ color: '#2a7', fontWeight: 700 }}>●</span>;
const X = <span style={{ color: '#DDD' }}>·</span>;

export default function PermissionMatrix({ users }: { users: UserProfile[] }) {
  const [tab, setTab] = useState<'menu' | 'cap' | 'user'>('menu');
  /** 이름으로 갈리는 메뉴가 있어(hideFor·onlyFor) 등급만으로는 답이 안 나온다. */
  const [who, setWho] = useState('');

  const rows = useMemo(() => {
    const out: { group: string; item: MenuItem; depth: number }[] = [];
    for (const g of MENU_GROUPS) {
      for (const it of g.items) {
        out.push({ group: g.label, item: it, depth: 0 });
        for (const ch of it.children ?? []) out.push({ group: g.label, item: ch, depth: 1 });
      }
    }
    for (const it of ICON_ITEMS) out.push({ group: '우측 아이콘', item: it, depth: 0 });
    return out;
  }, []);

  const groupOf = (label: string) => MENU_GROUPS.find((g) => g.label === label);
  /** 그 등급·그 사람에게 이 메뉴가 보이는가. 대분류 가림(인당회계사)까지 함께 본다. */
  const visible = (role: Role, name: string, r: { group: string; item: MenuItem }) => {
    const g = groupOf(r.group);
    if (g && !groupAllowed(role, g)) return false;
    return menuAllowed(role, name, r.item);
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        🔐 권한 현황
        <span style={{ display: 'flex', gap: 4 }}>
          <button className={tab === 'menu' ? 'btn-p' : 'btn-sm'} onClick={() => setTab('menu')}>메뉴 × 등급</button>
          <button className={tab === 'cap' ? 'btn-p' : 'btn-sm'} onClick={() => setTab('cap')}>권한 × 등급</button>
          <button className={tab === 'user' ? 'btn-p' : 'btn-sm'} onClick={() => setTab('user')}>사용자별</button>
        </span>
        {tab === 'menu' && (
          <label style={{ fontSize: 11.5, marginLeft: 'auto' }}>
            이름으로 갈리는 메뉴 확인{' '}
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">(이름 무관)</option>
              {users.map((u) => <option key={u.id} value={u.name}>{u.name || u.email}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="alert-i" style={{ fontSize: 11 }}>
        여기 보이는 것은 설명이 아니라 <b>화면이 실제로 쓰는 규칙</b>입니다(<code>lib/menu.ts</code>·<code>lib/roles.ts</code>).
        메뉴나 권한을 고치면 이 표가 저절로 따라옵니다.
        <br />● = 메뉴가 보이고 접근 가능 · · = 보이지 않음. <b>메뉴가 보인다고 다 쓸 수 있는 것은 아닙니다</b> —
        쓰기 여부는 <b>권한 × 등급</b> 탭과 화면별 <code>readonly</code>가 함께 정합니다.
        <br />일부 메뉴는 등급이 아니라 <b>이름</b>으로 갈립니다(매출통계는 김민섭·김동주 제외, 기초미수금 입력은 관리자만).
        오른쪽에서 사람을 골라 확인하세요.
      </div>

      {tab === 'menu' && (
        <div className="tbl-scroll" style={{ maxHeight: '62vh' }}>
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 110 }}>대분류</th>
                <th style={{ minWidth: 180 }}>메뉴</th>
                <th>필요 권한</th>
                {ROLES.map((r) => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABELS[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.item.id}:${i}`}>
                  <td style={{ color: '#888' }}>{i === 0 || rows[i - 1].group !== r.group ? r.group : ''}</td>
                  <td style={{ fontWeight: r.depth ? 400 : 700, color: '#1A2B52', paddingLeft: r.depth ? 18 : undefined }}>
                    {r.depth ? '└ ' : ''}{r.item.label}
                    {r.item.hideFor && <Tag>제외 {r.item.hideFor.join('·')}</Tag>}
                    {r.item.onlyFor && <Tag>{r.item.onlyFor.join('·')}·관리자만</Tag>}
                  </td>
                  <td style={{ fontSize: 10.5, color: '#888' }}>
                    {r.item.cap ? CAP_LABELS[r.item.cap] : '—'}
                  </td>
                  {ROLES.map((role) => (
                    <td key={role} style={{ textAlign: 'center' }}>
                      {visible(role, who, r) ? O : X}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'cap' && (
        <div className="tbl-scroll" style={{ maxHeight: '62vh' }}>
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>권한</th>
                <th style={{ minWidth: 130, color: '#888' }}>코드</th>
                {ROLES.map((r) => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABELS[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {CAPS.map((c) => (
                <tr key={c}>
                  <td style={{ fontWeight: 700, color: '#1A2B52' }}>{CAP_LABELS[c]}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 10.5, color: '#888' }}>{c}</td>
                  {ROLES.map((role) => (
                    <td key={role} style={{ textAlign: 'center' }}>{can(role, c) ? O : X}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'user' && (
        <div className="tbl-scroll" style={{ maxHeight: '62vh' }}>
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <thead>
              <tr>
                <th>이름</th><th>이메일</th><th>등급</th><th className="r">보이는 메뉴</th>
                <th>가진 권한</th><th>쓰기잠금</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, color: '#BBB' }}>사용자가 없습니다.</td></tr>
              )}
              {users.map((u) => {
                const role = u.role as Role;
                const seen = rows.filter((r) => visible(role, u.name, r)).length;
                const caps = CAPS.filter((c) => can(role, c));
                return (
                  <tr key={u.id} style={{ opacity: u.readonly ? 0.6 : 1 }}>
                    <td style={{ fontWeight: 700, color: '#1A2B52' }}>{u.name || '—'}</td>
                    <td style={{ fontSize: 11, color: '#666' }}>{u.email}</td>
                    <td style={{ fontWeight: 700 }}>{ROLE_LABELS[role] ?? u.role}</td>
                    <td className="r">{seen} / {rows.length}</td>
                    <td style={{ fontSize: 10.5, color: '#666' }}>
                      {caps.length ? caps.map((c) => CAP_LABELS[c]).join(' · ') : '없음'}
                    </td>
                    <td>{u.readonly ? <span style={{ color: '#c33', fontWeight: 700 }}>잠김(조회만)</span> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      marginLeft: 4, fontSize: 9.5, fontWeight: 700, padding: '0 4px', borderRadius: 3,
      color: '#5B21B6', background: '#EDE9FE', border: '1px solid #C4B5FD', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

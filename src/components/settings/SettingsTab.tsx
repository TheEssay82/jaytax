// 설정 탭 — 수수료 설정(다중 버전) + 설명 변경. 원본 rSettings 확장.
import { useEffect, useRef, useState } from 'react';
import type { AppConfig } from '../../types';
import { DEFAULT_CONFIG, FEE_LABELS, HELP_TEXTS, HELP_KEYS } from '../../lib/constants';
import { useConfig } from '../../context/ConfigContext';
import { DEFAULT_VERSION_ID } from '../../lib/configApi';

type WeightKey = '방문횟수' | '전화횟수' | '상담난이도' | '업무해당' | '업무량' | '업무난이도' | '증빙금액';
const WEIGHT_GROUPS: [string, WeightKey, boolean][] = [
  ['방문상담 횟수별 가산율', '방문횟수', false],
  ['전화상담 횟수별 가산율', '전화횟수', false],
  ['상담 난이도별 가산율', '상담난이도', false],
  ['업무 해당여부 가산율', '업무해당', false],
  ['업무량별 가산율', '업무량', false],
  ['업무 난이도별 가산율', '업무난이도', false],
  ['증빙업무 금액', '증빙금액', true],
];

export default function SettingsTab() {
  const { config, activeId, activeLabel, versions, loading, error, apply, saveNew, overwrite, remove } =
    useConfig();
  const [sub, setSub] = useState<'fee' | 'help'>('fee');
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_VERSION_ID);
  const [draft, setDraft] = useState<AppConfig>(config);
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const inited = useRef(false);

  const isDefault = selectedId === DEFAULT_VERSION_ID;

  function selectVersion(id: string) {
    const v = versions.find((x) => x.id === id) || versions[0];
    setSelectedId(v.id);
    setDraft(structuredClone(v.config));
    setLabel(v.id === DEFAULT_VERSION_ID ? '' : v.label);
  }

  // 최초 로드 / 활성버전 변경(적용·저장 후) 시 편집기를 활성버전으로 동기화
  useEffect(() => {
    if (loading) return;
    if (!inited.current) inited.current = true;
    selectVersion(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, loading]);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(''), 2500);
  }

  function setWeight(key: WeightKey, k: string, val: string) {
    const v = parseFloat(val) || 0;
    setDraft((d) => ({ ...d, [key]: { ...d[key], [k]: v } }));
  }
  function setBracket(type: 'law' | 'per', i: number, field: 'flat' | 'rate', val: string) {
    const key = type === 'law' ? 'lawBrackets' : 'perBrackets';
    const num = parseFloat(val.replace(/,/g, '')) || 0;
    setDraft((d) => ({
      ...d,
      [key]: d[key].map((b, idx) => (idx === i ? { ...b, [field]: field === 'rate' ? num / 100 : num } : b)),
    }));
  }
  function setModelBase(val: string) {
    setDraft((d) => ({ ...d, 성실신고기본: parseFloat(val.replace(/,/g, '')) || 0 }));
  }
  function setHelp(k: string, val: string) {
    setDraft((d) => ({ ...d, helpTexts: { ...d.helpTexts, [k]: val } }));
  }

  async function doApply() {
    setSaving(true);
    try {
      await apply(selectedId);
      flash('✓ 적용됨');
    } catch (e) {
      alert('적용 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }
  async function doSaveNew() {
    if (!label.trim()) {
      alert('새 버전명을 입력하세요.');
      return;
    }
    setSaving(true);
    try {
      await saveNew(draft, label.trim());
      flash('✓ 새 버전 저장·적용됨');
    } catch (e) {
      alert('저장 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }
  async function doOverwrite() {
    if (isDefault) return;
    if (!confirm(`'${label}' 버전을 덮어쓰시겠습니까?`)) return;
    setSaving(true);
    try {
      await overwrite(selectedId, draft, label.trim() || '기본');
      flash('✓ 덮어쓰기 저장됨');
    } catch (e) {
      alert('저장 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }
  async function doDelete() {
    if (isDefault) return;
    if (!confirm(`'${label}' 버전을 삭제하시겠습니까?`)) return;
    setSaving(true);
    try {
      await remove(selectedId);
      flash('✓ 삭제됨');
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }
  function loadDefaultIntoEditor() {
    setDraft(structuredClone(DEFAULT_CONFIG));
    flash('DEFAULT 값을 편집기에 불러왔습니다. 새 버전명을 입력하고 저장하세요.');
  }

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">⚙️ 설정</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  const subBar = (
    <div className="cfg-subtabs">
      <button className={`cfg-stab${sub === 'fee' ? ' on' : ''}`} onClick={() => setSub('fee')}>
        % 수수료 적용 변경
      </button>
      <button className={`cfg-stab${sub === 'help' ? ' on' : ''}`} onClick={() => setSub('help')}>
        📖 설명 변경
      </button>
    </div>
  );

  // 버전 관리 바 (공통)
  const versionBar = (
    <>
      <div className="set-t">⚙️ 설정 버전</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: '#555' }}>현재 적용:</span>
        <span className="ver-badge">{activeLabel}</span>
        <span style={{ fontSize: 11, color: '#aaa', marginLeft: 4 }}>편집 중:</span>
        <select
          value={selectedId}
          onChange={(e) => selectVersion(e.target.value)}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #D0CCC4', borderRadius: 6 }}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
              {v.isActive ? ' (적용중)' : ''}
            </option>
          ))}
        </select>
        {selectedId !== activeId && (
          <button className="btn-sm btn-sm-grn" onClick={doApply} disabled={saving}>
            이 버전 적용
          </button>
        )}
        {!isDefault && (
          <button className="btn-sm btn-sm-del" onClick={doDelete} disabled={saving}>
            버전 삭제
          </button>
        )}
      </div>
      {isDefault ? (
        <div className="alert-i" style={{ fontSize: 11 }}>
          DEFAULT(코드 기본값)는 수정할 수 없습니다. 아래에서 값을 보고, 바꾸려면 <strong>새 버전명</strong>을 입력해{' '}
          <strong>새 버전으로 저장</strong>하세요.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <button className="btn-sm" onClick={loadDefaultIntoEditor} disabled={saving}>
            ↺ DEFAULT 값 불러오기
          </button>
        </div>
      )}
    </>
  );

  const saveBar = (
    <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
      <input
        value={label}
        placeholder="새 버전명 (예: 2025년 적용)"
        onChange={(e) => setLabel(e.target.value)}
        style={{ padding: '5px 9px', border: '1px solid #D0CCC4', borderRadius: 6, fontSize: 12, width: 180 }}
      />
      <button className="btn-p" onClick={doSaveNew} disabled={saving}>
        💾 새 버전으로 저장·적용
      </button>
      {!isDefault && (
        <button className="btn-s" onClick={doOverwrite} disabled={saving}>
          이 버전 덮어쓰기
        </button>
      )}
      {msg && <span style={{ fontSize: 11, color: '#059669' }}>{msg}</span>}
    </div>
  );

  if (sub === 'help') {
    return (
      <div className="card">
        <div className="chdr">업무량 항목 설명 관리</div>
        {subBar}
        {error && <div className="alert-w">{error}</div>}
        {versionBar}
        <div className="alert-i">설명 텍스트 수정 후 저장(새 버전/덮어쓰기)해야 영구 반영됩니다.</div>
        {HELP_KEYS.map((k) => (
          <div key={k} style={{ marginBottom: 14 }}>
            <strong style={{ fontSize: 13, color: '#1A2B52' }}>{k}</strong>
            <textarea
              rows={5}
              disabled={isDefault}
              value={draft.helpTexts?.[k] ?? HELP_TEXTS[k] ?? ''}
              onChange={(e) => setHelp(k, e.target.value)}
              style={{
                width: '100%',
                marginTop: 5,
                padding: '7px 9px',
                border: '1px solid #D0CCC4',
                borderRadius: 7,
                fontSize: 12,
                fontFamily: 'inherit',
                resize: 'vertical',
                lineHeight: 1.6,
                background: isDefault ? '#F5F5F5' : '#fff',
              }}
            />
          </div>
        ))}
        {saveBar}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">설정</div>
      {subBar}
      {error && <div className="alert-w">{error}</div>}
      {versionBar}

      <div className="set-t" style={{ marginTop: 14 }}>💰 기준수수료 누진 구간</div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
        법인/개인 사업자별 매출액 구간에 따른 조정수수료율을 설정합니다.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="fee-tbl">
          <thead>
            <tr>
              <th>기준금액 (매출액)</th>
              <th>법인사업자</th>
              <th>개인사업자</th>
            </tr>
          </thead>
          <tbody>
            {FEE_LABELS.map((lbl, i) => {
              const lb = draft.lawBrackets[i];
              const pb = draft.perBrackets[i];
              if (!lb || !pb) return null;
              const isFlat = i === 0;
              return (
                <tr key={lbl}>
                  <td>{lbl}</td>
                  <td>
                    <input
                      inputMode="numeric"
                      disabled={isDefault}
                      value={isFlat ? (lb.flat ?? 0) : ((lb.rate ?? 0) * 100).toFixed(3)}
                      onChange={(e) => setBracket('law', i, isFlat ? 'flat' : 'rate', e.target.value)}
                    />{' '}
                    {isFlat ? '원' : '%'}
                  </td>
                  <td>
                    <input
                      inputMode="numeric"
                      disabled={isDefault}
                      value={isFlat ? (pb.flat ?? 0) : ((pb.rate ?? 0) * 100).toFixed(3)}
                      onChange={(e) => setBracket('per', i, isFlat ? 'flat' : 'rate', e.target.value)}
                    />{' '}
                    {isFlat ? '원' : '%'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="set-t" style={{ marginTop: 14 }}>성실신고 기본 수수료</div>
      <div className="set-grid">
        <div className="set-item">
          <div className="set-key">기본금액</div>
          <div className="set-lbl">금액 (원)</div>
          <input inputMode="numeric" disabled={isDefault} value={draft.성실신고기본} onChange={(e) => setModelBase(e.target.value)} />
        </div>
      </div>

      {WEIGHT_GROUPS.map(([title, key, isAmt]) => (
        <div key={key}>
          <div className="set-t">{title}</div>
          <div className="set-grid">
            {Object.entries(draft[key]).map(([k, v]) => (
              <div className="set-item" key={k}>
                <div className="set-key">{k}</div>
                <div className="set-lbl">{isAmt ? '금액 (원)' : '가산율'}</div>
                <input inputMode="numeric" disabled={isDefault} value={v} onChange={(e) => setWeight(key, k, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {saveBar}
    </div>
  );
}

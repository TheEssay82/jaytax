// 설정 탭 — 원본 rSettings 포팅 (수수료 설정 + 설명 변경, DB 연동)
import { useEffect, useState } from 'react';
import type { AppConfig } from '../../types';
import { DEFAULT_CONFIG, FEE_LABELS, HELP_TEXTS } from '../../lib/constants';
import { useConfig } from '../../context/ConfigContext';

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
const HELP_KEYS = ['방문', '전화', '장부', '결산', '조정', '증빙', '원가'];

export default function SettingsTab() {
  const { config, loading, error, persist } = useConfig();
  const [sub, setSub] = useState<'fee' | 'help'>('fee');
  const [draft, setDraft] = useState<AppConfig>(config);
  const [label, setLabel] = useState(config.cfgVersionLabel || '기본');
  const [savedMsg, setSavedMsg] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(config);
    setLabel(config.cfgVersionLabel || '기본');
  }, [config]);

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

  async function save() {
    setSaving(true);
    try {
      const newId = 'v' + Date.now();
      const history = [
        { id: newId, label: label || '기본', savedAt: new Date().toISOString() },
        ...(draft.cfgHistory || []),
      ].slice(0, 20);
      await persist({ ...draft, cfgVersionId: newId, cfgVersionLabel: label || '기본', cfgHistory: history });
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } catch (e) {
      alert('저장 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirm('기본값으로 복원하시겠습니까? (저장하면 적용됩니다)')) return;
    setDraft(structuredClone(DEFAULT_CONFIG));
    setLabel('기본');
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

  const saveBar = (
    <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
      <button className="btn-p" onClick={save} disabled={saving}>
        {saving ? '저장 중…' : '💾 설정 저장'}
      </button>
      {sub === 'fee' && (
        <button className="btn-s" onClick={reset} disabled={saving}>
          ↺ 기본값 복원
        </button>
      )}
      {savedMsg && <span style={{ fontSize: 11, color: '#059669' }}>✓ 저장완료</span>}
    </div>
  );

  if (sub === 'help') {
    return (
      <div className="card">
        <div className="chdr">업무량 항목 설명 관리</div>
        {subBar}
        {error && <div className="alert-w">{error}</div>}
        <div className="alert-i">설명 텍스트 수정 후 <strong>설정 저장</strong>을 눌러야 영구 저장됩니다.</div>
        {HELP_KEYS.map((k) => (
          <div key={k} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              <strong style={{ fontSize: 13, color: '#1A2B52' }}>{k}</strong>
            </div>
            <textarea
              rows={5}
              value={draft.helpTexts?.[k] ?? HELP_TEXTS[k] ?? ''}
              onChange={(e) => setHelp(k, e.target.value)}
              style={{
                width: '100%',
                padding: '7px 9px',
                border: '1px solid #D0CCC4',
                borderRadius: 7,
                fontSize: 12,
                fontFamily: 'inherit',
                resize: 'vertical',
                lineHeight: 1.6,
              }}
            />
          </div>
        ))}
        {saveBar}
      </div>
    );
  }

  const hist = (draft.cfgHistory || []).slice(0, 8);

  return (
    <div className="card">
      <div className="chdr">설정</div>
      {subBar}
      {error && <div className="alert-w">{error}</div>}
      <div className="alert-i">수정 후 <strong>설정 저장</strong>을 눌러야 영구 저장됩니다.</div>

      <div className="set-t">⚙️ 설정 버전 관리</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: '#555' }}>현재 버전:</span>
        <span className="ver-badge">{config.cfgVersionLabel || '기본'}</span>
        <span style={{ fontSize: 11, color: '#aaa' }}>{config.cfgVersionId || 'v0'}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap' }}>저장 시 버전명:</span>
        <input
          value={label}
          placeholder="예: 2025년 적용"
          onChange={(e) => setLabel(e.target.value)}
          style={{ padding: '4px 8px', border: '1px solid #D0CCC4', borderRadius: 6, fontSize: 12, width: 180 }}
        />
      </div>
      <div className="set-t">버전 이력 (최근 8개)</div>
      {hist.length ? (
        <div className="ver-hist-row">
          {hist.map((v, i) => (
            <span key={v.id}>
              <span className="ver-badge" title={v.savedAt?.slice(0, 16) || ''}>
                {v.label}
              </span>
              {i < hist.length - 1 ? ' → ' : ''}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#bbb' }}>아직 저장된 이력이 없습니다.</div>
      )}

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
                      value={isFlat ? (lb.flat ?? 0) : ((lb.rate ?? 0) * 100).toFixed(3)}
                      onChange={(e) => setBracket('law', i, isFlat ? 'flat' : 'rate', e.target.value)}
                    />{' '}
                    {isFlat ? '원' : '%'}
                  </td>
                  <td>
                    <input
                      inputMode="numeric"
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
          <input inputMode="numeric" value={draft.성실신고기본} onChange={(e) => setModelBase(e.target.value)} />
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
                <input inputMode="numeric" value={v} onChange={(e) => setWeight(key, k, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {saveBar}
    </div>
  );
}

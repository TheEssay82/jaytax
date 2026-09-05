// 문서발송 — 「발송요청 및 처리」 한 자리.
//
// 왜 합치나: 요청과 처리는 **같은 건이 지나가는 두 단계**다. 메뉴를 둘로 두면
// 「내가 올린 게 처리됐나」를 보려고 메뉴를 왔다 갔다 해야 했다.
// 세금계산서 발행요청·감사팀과 같은 모양(클릭 전환 탭)으로 맞춘다.
//
// **두 화면의 속은 건드리지 않는다.** 여기서는 껍데기(제목·탭)만 그리고 안쪽은 그대로
// 불러 쓴다 — 각 화면이 자기 자료·권한·저장을 이미 스스로 챙기고 있고, 그것까지 합치면
// 위험만 커진다.
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import { countDispatchPending } from '../../lib/homeApi';
import DocSendRequestTab from './DocSendRequestTab';
import DocSendProcessTab from './DocSendProcessTab';

type Pane = 'request' | 'process';

export default function DocSendTab({ initial = 'request' }: { initial?: Pane }) {
  const { role } = useAuth();
  // 처리 자리는 등급으로 갈린다 — 인당회계사에게는 **탭 자체를 내놓지 않는다**.
  // 메뉴가 하나로 합쳐졌어도 보이는 범위는 전과 같아야 한다.
  const canProcess = can(role, 'viewDispatch');
  // 홈의 「처리 대기 발송요청」 타일처럼 처리 자리를 바로 여는 길이 있다.
  const [pane, setPane] = useState<Pane>(initial);
  const [pending, setPending] = useState<number | null>(null);

  // 처리 대기 건수 — 탭에 들어가 보지 않아도 알 수 있어야 알림 구실을 한다.
  useEffect(() => {
    if (!canProcess) return;
    let alive = true;
    void countDispatchPending()
      .then((n) => { if (alive) setPending(n); })
      .catch(() => { if (alive) setPending(null); });
    return () => { alive = false; };
  }, [canProcess, pane]);

  return (
    <>
      <div className="pane-bar">
        <button className={pane === 'request' ? 'on' : ''} onClick={() => setPane('request')}
          title="발송을 의뢰하는 자리 — 올리고, 고치고, 취소합니다">
          ✉️ 발송요청
        </button>
        {canProcess && (
          <button className={pane === 'process' ? 'on' : ''} onClick={() => setPane('process')}
            title="의뢰받은 건을 실제로 보내고 마감하는 자리">
            🖨️ 발송 처리
            {pending ? <span className="pane-bdg warn">대기 {pending}</span> : null}
          </button>
        )}
      </div>

      {pane === 'request' && <DocSendRequestTab />}
      {pane === 'process' && canProcess && <DocSendProcessTab />}
    </>
  );
}

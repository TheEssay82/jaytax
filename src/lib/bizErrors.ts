/**
 * 거래처 저장 오류를 **사람 말로** 바꾼다.
 *
 * 왜 필요한가: 2026-09-10 에 거래처등록이 이 말과 함께 실패했다 —
 *   「등록 실패: duplicate key value violates unique constraint "biz_entity_code_key"」
 * 사장님이 이걸 보고 할 수 있는 일은 없다. 무엇이 겹쳤는지, 어디를 고쳐야 하는지가
 * 한 줄도 없기 때문이다. 그래서 **무엇이 겹쳤는지와 다음에 할 일**을 적어 준다.
 *
 * 아는 것만 바꾸고 모르는 것은 원문 그대로 둔다 — 원문이 없어지면 나중에 못 고친다.
 */

/** 제약(인덱스) 이름 → 사람 말. DB 에 있는 이름 그대로 적는다. */
const RULES: { key: string; say: string }[] = [
  { key: 'uniq_place_biz_reg', say: '이미 등록된 사업자등록번호입니다. 같은 번호의 사업장이 이미 있으니, 거래처 목록에서 그 사업장을 찾아 고쳐 주세요.' },
  { key: 'uniq_place_entity_name', say: '이 거래처에 같은 이름의 사업장이 이미 있습니다. 사업장 이름을 다르게 적어 주세요.' },
  { key: 'uniq_place_hq', say: '이 거래처에는 본사 사업장이 이미 있습니다. 본사는 하나만 둘 수 있습니다.' },
  { key: 'biz_place_erp_client_code_key', say: '이미 쓰이고 있는 ERP 거래처코드입니다.' },
  { key: 'biz_entity_code_key', say: '거래처 코드가 겹쳤습니다. 다시 한 번 눌러 보시고, 그래도 같으면 알려 주세요(채번 문제입니다).' },
];

/** 겹침(unique) 오류인지 — 제약 이름을 못 찾아도 이 말은 해 줄 수 있다. */
const DUP = /duplicate key value|violates unique constraint/i;

/**
 * 오류 하나를 한 줄로. 아는 제약이면 그 설명을, 모르는 겹침이면 겹쳤다는 사실을,
 * 그 밖에는 원문을 돌려준다.
 */
export function bizErr(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  for (const r of RULES) if (raw.includes(r.key)) return r.say;
  if (DUP.test(raw)) return `이미 등록된 값이 있어 저장하지 못했습니다.\n(${raw})`;
  return raw || '알 수 없는 오류입니다.';
}

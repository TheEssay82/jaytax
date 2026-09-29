// 우체국 우편 업로드 양식 — 주소 나누기(실제 담당자 주소 꼴)·전화 나누기·우편번호.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAddress, splitPhone, takeZip, toPostRow, POST_HEAD } from './postUpload';
import type { SendRequest } from './docSendApi';

test('주소 — 도로명 + 건물번호 / 상세(쉼표·괄호·층·호·띄어 쓴 「1길」·「번길」)', () => {
  const cases: [string, string, string][] = [
    ['서울 강남구 도산대로11길 29, 3층', '서울 강남구 도산대로11길 29', '3층'],
    ['서울 강남구 테헤란로 88길 15, 한국호쿠쇼타워 4층', '서울 강남구 테헤란로 88길 15', '한국호쿠쇼타워 4층'],
    ['충청남도 천안시 서북구 수레터 1길 44 ㈜주원이노베이션', '충청남도 천안시 서북구 수레터 1길 44', '㈜주원이노베이션'],
    ['경기도 성남시 분당구 판교로 256번길 7 넥슨코리아 연결회계실', '경기도 성남시 분당구 판교로 256번길 7', '넥슨코리아 연결회계실'],
    ['서울시 강남구 테헤란로 447,11층', '서울시 강남구 테헤란로 447', '11층'],
    ['경기도 용인시 처인구 이동면 백옥대로 250(시미리 188)', '경기도 용인시 처인구 이동면 백옥대로 250', '(시미리 188)'],
    ['경기 평택시 청북읍 드림산단5로 55', '경기 평택시 청북읍 드림산단5로 55', ''],
    ['서울 서초구 방배동 919-1 지호빌딩 204호', '서울 서초구 방배동 919-1', '지호빌딩 204호'],
  ];
  for (const [a, addr, detail] of cases) assert.deepEqual(splitAddress(a), { addr, detail }, a);
});

test('전화 — 010 은 휴대, 그 밖은 일반, 둘 다 있으면 나눠 담고 하이픈을 맞춘다', () => {
  assert.deepEqual(splitPhone('010 1234 5678'), { tel: '', mobile: '010-1234-5678' });
  assert.deepEqual(splitPhone('02-3456-7890'), { tel: '02-3456-7890', mobile: '' });
  assert.deepEqual(splitPhone('031-123-4567 / 010-9876-5432'), { tel: '031-123-4567', mobile: '010-9876-5432' });
  assert.deepEqual(splitPhone(''), { tel: '', mobile: '' });
});

test('우편번호 — 주소 속 5자리를 떼고, 담당자에 저장된 번호가 먼저', () => {
  assert.deepEqual(takeZip('(06236) 서울 강남구 테헤란로 152'), { zip: '06236', rest: '서울 강남구 테헤란로 152' });
  assert.deepEqual(takeZip('서울 강남구 테헤란로 152'), { zip: '', rest: '서울 강남구 테헤란로 152' });
  const r = { id: 'r1', companyName: '주식회사 알티스트', recipientName: '홍길동', recipientTitle: '대리', address: '(04157) 서울 마포구 마포대로12길 34, 3층', phone: '010-1111-2222' } as SendRequest;
  const row = toPostRow(r, { bizContactId: 'b1', zip: null });
  assert.deepEqual([row.name, row.zip, row.addr, row.detail, row.mobile], ['주식회사 알티스트 홍길동 대리님', '04157', '서울 마포구 마포대로12길 34', '3층', '010-1111-2222']);
  assert.equal(toPostRow(r, { bizContactId: 'b1', zip: '04100' }).zip, '04100');
  assert.equal(POST_HEAD.length, 8);
});

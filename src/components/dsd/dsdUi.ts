// 주석·DSD 화면들이 함께 쓰는 잔손질.
//
// 파일 이름을 짓는 규칙과 내려받기가 탭마다 흩어져 있으면 어긋난다 — 실제로 ② 와 ④ 가
// 서로 다른 이름을 붙이고 있었다.

/** 파일 이름에 못 쓰는 글자를 걷어낸다. */
export function safeName(s: string): string {
  return (s ?? '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

/** 브라우저에서 바로 내려받는다 — 서버를 거치지 않는다. */
export function download(bytes: Uint8Array, name: string, type: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

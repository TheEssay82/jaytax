// 습작 열람 화면의 배경·서체 프리셋. 이미지 파일 없이 CSS/SVG 로만 그린다(작품별 이미지 업로드로 덮어쓸 수 있음).
import type { CSSProperties } from 'react';

/** 종이결(한지) 노이즈 — SVG feTurbulence 를 data URI 로 */
const grain = (opacity: number) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='${opacity}'/%3E%3C/svg%3E")`;

/** 밤하늘 별 — 불규칙한 점 몇 개 */
const stars =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='420'%3E%3Cg fill='%23ffffff'%3E%3Ccircle cx='34' cy='58' r='1.1' opacity='.75'/%3E%3Ccircle cx='128' cy='22' r='.8' opacity='.5'/%3E%3Ccircle cx='210' cy='96' r='1.4' opacity='.85'/%3E%3Ccircle cx='302' cy='44' r='.9' opacity='.55'/%3E%3Ccircle cx='384' cy='130' r='1.1' opacity='.7'/%3E%3Ccircle cx='66' cy='186' r='.9' opacity='.6'/%3E%3Ccircle cx='158' cy='250' r='1.3' opacity='.8'/%3E%3Ccircle cx='246' cy='198' r='.8' opacity='.45'/%3E%3Ccircle cx='330' cy='286' r='1.1' opacity='.7'/%3E%3Ccircle cx='96' cy='330' r='1' opacity='.6'/%3E%3Ccircle cx='196' cy='378' r='.9' opacity='.5'/%3E%3Ccircle cx='288' cy='352' r='1.2' opacity='.75'/%3E%3Ccircle cx='400' cy='396' r='.8' opacity='.5'/%3E%3C/g%3E%3C/svg%3E")`;

/** 원고지 괘선 */
const ruled =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M0 39.5H40' stroke='%23c9d4e2' stroke-width='1' opacity='.5'/%3E%3Cpath d='M39.5 0V40' stroke='%23c9d4e2' stroke-width='1' opacity='.28'/%3E%3C/svg%3E")`;

export type EssayTheme = {
  key: string;
  label: string;
  page: CSSProperties; // 화면 전체 배경
  sheet: CSSProperties; // 글이 얹히는 반투명 판
  ink: string; // 본문 색
  soft: string; // 보조 텍스트 색
  accent: string; // 별점 색
  swatch: string; // 관리화면 미리보기용 축소 배경
  /** 사진 프리셋: essay-bg 버킷의 경로. 있으면 page 대신 이 사진을 깐다. */
  photo?: string;
  /** 사진 위에 덮는 막(밝은 사진엔 흰 막, 어두운 사진엔 검은 막) */
  overlay?: string;
};

export const THEMES: EssayTheme[] = [
  {
    key: 'hanji',
    label: '한지',
    page: {
      background: `${grain(0.075)}, radial-gradient(120% 90% at 50% 0%, #f6efdd 0%, #eadfc6 60%, #e0d3b6 100%)`,
      backgroundBlendMode: 'multiply, normal',
    },
    sheet: { background: 'rgba(255,252,244,0.62)', boxShadow: '0 18px 60px rgba(90,72,42,0.14)' },
    ink: '#332c20',
    soft: '#8b7c63',
    accent: '#a9742c',
    swatch: 'radial-gradient(120% 90% at 50% 0%, #f6efdd 0%, #e0d3b6 100%)',
  },
  {
    key: 'sumuk',
    label: '수묵',
    page: {
      background: `${grain(0.05)}, radial-gradient(60% 50% at 18% 12%, rgba(60,72,84,0.16) 0%, rgba(60,72,84,0) 70%), radial-gradient(55% 45% at 84% 78%, rgba(40,52,66,0.14) 0%, rgba(40,52,66,0) 72%), linear-gradient(180deg, #f7f7f4 0%, #eceeea 100%)`,
      backgroundBlendMode: 'multiply, normal, normal, normal',
    },
    sheet: { background: 'rgba(255,255,255,0.66)', boxShadow: '0 18px 60px rgba(40,50,60,0.12)' },
    ink: '#232830',
    soft: '#7b8290',
    accent: '#3f5a72',
    swatch: 'radial-gradient(60% 60% at 20% 20%, rgba(60,72,84,0.22), rgba(0,0,0,0) 70%), linear-gradient(180deg,#f7f7f4,#eceeea)',
  },
  {
    key: 'night',
    label: '밤하늘',
    page: {
      background: `${stars}, radial-gradient(120% 90% at 50% -10%, #1b2a48 0%, #101a30 45%, #080d1a 100%)`,
    },
    sheet: { background: 'rgba(10,16,30,0.52)', boxShadow: '0 18px 70px rgba(0,0,0,0.45)' },
    ink: '#e9edf7',
    soft: '#9aa7c2',
    accent: '#f0c65a',
    swatch: 'radial-gradient(120% 90% at 50% -10%, #1b2a48 0%, #080d1a 100%)',
  },
  {
    key: 'dawn',
    label: '새벽',
    page: {
      background: `${grain(0.05)}, linear-gradient(165deg, #fdece1 0%, #f3dfe6 38%, #e2ddf0 70%, #d9e3f1 100%)`,
      backgroundBlendMode: 'multiply, normal',
    },
    sheet: { background: 'rgba(255,255,255,0.58)', boxShadow: '0 18px 60px rgba(120,90,120,0.15)' },
    ink: '#3b3040',
    soft: '#8b7d94',
    accent: '#b0698b',
    swatch: 'linear-gradient(165deg,#fdece1,#e2ddf0 70%,#d9e3f1)',
  },
  {
    key: 'forest',
    label: '숲',
    page: {
      background: `${grain(0.09)}, radial-gradient(110% 90% at 30% 0%, #24402f 0%, #16281f 55%, #0e1a14 100%)`,
      backgroundBlendMode: 'overlay, normal',
    },
    sheet: { background: 'rgba(12,24,18,0.5)', boxShadow: '0 18px 70px rgba(0,0,0,0.4)' },
    ink: '#e8f0e6',
    soft: '#9ab3a2',
    accent: '#cbb26a',
    swatch: 'radial-gradient(110% 90% at 30% 0%, #24402f, #0e1a14)',
  },
  {
    key: 'manuscript',
    label: '원고지',
    page: { background: `${ruled}, linear-gradient(180deg, #fdfdfb 0%, #f6f7f9 100%)` },
    sheet: { background: 'rgba(255,255,255,0.78)', boxShadow: '0 14px 44px rgba(30,50,80,0.10)' },
    ink: '#22262c',
    soft: '#79808c',
    accent: '#2f6fa8',
    swatch: 'linear-gradient(180deg,#fdfdfb,#eef1f6)',
  },
];

/** 사진 프리셋 — Openverse(api.openverse.org) 에서 `license=cc0` 로 받은 퍼블릭 도메인 이미지.
 *  출처: night-stars=rawpixel, 나머지 4장=stocksnap. 모두 CC0 이므로 저작자 표시 의무 없음.
 *  가로 1920px·JPEG q82 로 줄여 essay-bg 버킷의 preset/ 에 올려두었다(0065 롤백 시 버킷째 삭제). */
export const PHOTO_THEMES: EssayTheme[] = [
  {
    key: 'photo-night-stars',
    label: '별밤',
    photo: 'preset/night-stars.jpg',
    overlay: 'linear-gradient(rgba(4,8,20,0.45), rgba(4,8,20,0.55))',
    page: {},
    sheet: { background: 'rgba(8,14,28,0.5)', boxShadow: '0 18px 70px rgba(0,0,0,0.5)' },
    ink: '#eceff8',
    soft: '#a3adc6',
    accent: '#f0c65a',
    swatch: '',
  },
  {
    key: 'photo-moon-night',
    label: '달밤',
    photo: 'preset/moon-night.jpg',
    overlay: 'linear-gradient(rgba(2,10,14,0.42), rgba(2,10,14,0.56))',
    page: {},
    sheet: { background: 'rgba(6,16,20,0.48)', boxShadow: '0 18px 70px rgba(0,0,0,0.5)' },
    ink: '#e8f0f2',
    soft: '#9db3b8',
    accent: '#e8d9a0',
    swatch: '',
  },
  {
    key: 'photo-dawn-violet',
    label: '새벽 보라',
    photo: 'preset/dawn-violet.jpg',
    overlay: 'linear-gradient(rgba(255,255,255,0.20), rgba(255,255,255,0.30))',
    page: {},
    sheet: { background: 'rgba(255,255,255,0.68)', boxShadow: '0 18px 60px rgba(60,60,110,0.18)' },
    ink: '#2c2b3f',
    soft: '#75738d',
    accent: '#6b62a8',
    swatch: '',
  },
  {
    key: 'photo-dusk-clouds',
    label: '노을 구름',
    photo: 'preset/dusk-clouds.jpg',
    overlay: 'linear-gradient(rgba(255,252,248,0.26), rgba(255,252,248,0.38))',
    page: {},
    sheet: { background: 'rgba(255,253,250,0.72)', boxShadow: '0 18px 60px rgba(120,70,40,0.18)' },
    ink: '#3a2a22',
    soft: '#8b7264',
    accent: '#c2743a',
    swatch: '',
  },
  {
    key: 'photo-pink-dusk',
    label: '분홍 어스름',
    photo: 'preset/pink-dusk.jpg',
    overlay: 'linear-gradient(rgba(255,250,250,0.24), rgba(255,250,250,0.36))',
    page: {},
    sheet: { background: 'rgba(255,252,252,0.72)', boxShadow: '0 18px 60px rgba(130,80,90,0.16)' },
    ink: '#3b2a30',
    soft: '#8d737b',
    accent: '#b8607a',
    swatch: '',
  },
];

/** 관리화면 배경 선택 목록 — CSS 프리셋 + 사진 프리셋 */
export const ALL_THEMES: EssayTheme[] = [...THEMES, ...PHOTO_THEMES];

export const themeOf = (key: string): EssayTheme => ALL_THEMES.find((t) => t.key === key) ?? THEMES[0];

export type EssayFont = { key: string; label: string; family: string; size: number; lineHeight: number; letterSpacing: string };

export const FONTS: EssayFont[] = [
  { key: 'myeongjo', label: '명조 (문학)', family: "'Nanum Myeongjo', 'Batang', serif", size: 19, lineHeight: 2.0, letterSpacing: '-0.005em' },
  { key: 'gowun', label: '고운바탕 (부드러움)', family: "'Gowun Batang', 'Nanum Myeongjo', serif", size: 19, lineHeight: 2.05, letterSpacing: '0' },
  { key: 'notoserif', label: '본명조 (또렷함)', family: "'Noto Serif KR', serif", size: 18, lineHeight: 1.95, letterSpacing: '-0.01em' },
  { key: 'sans', label: '고딕 (담백함)', family: "'Noto Sans KR', system-ui, sans-serif", size: 17.5, lineHeight: 1.95, letterSpacing: '-0.01em' },
];

export const fontOf = (key: string): EssayFont => FONTS.find((f) => f.key === key) ?? FONTS[0];

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Nanum+Myeongjo:wght@400;700&family=Noto+Sans+KR:wght@400;500&family=Noto+Serif+KR:wght@400;600&display=swap';

/** 습작 화면에서만 웹폰트를 로드한다(앱 전체 초기 로딩에 영향 없게). */
export function ensureEssayFonts(): void {
  if (document.getElementById('essay-fonts')) return;
  const link = document.createElement('link');
  link.id = 'essay-fonts';
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  document.head.appendChild(link);
}

/** 사진(작품별 업로드 또는 사진 프리셋)이 있으면 그것을, 없으면 CSS 프리셋을 배경으로 쓴다. */
export function pageStyle(theme: EssayTheme, bgImageUrl: string | null): CSSProperties {
  if (!bgImageUrl) return theme.page;
  // 업로드 이미지는 밝기를 모르므로 옅은 검은 막, 사진 프리셋은 각자 정해둔 막을 쓴다.
  const overlay = theme.overlay ?? 'linear-gradient(rgba(0,0,0,0.12), rgba(0,0,0,0.12))';
  return {
    backgroundImage: `${overlay}, url(${JSON.stringify(bgImageUrl)})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
  };
}

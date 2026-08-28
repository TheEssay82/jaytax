// 작품 한 편을 배경 위에 얹어 보여주는 지면(紙面). 열람 화면과 관리화면 미리보기가 함께 쓴다.
// 본문은 스크롤 없이 '한 번에' 전부 렌더한다(길면 페이지가 아래로 늘어난다).
import { useEffect, type ReactNode } from 'react';
import { bgUrl } from '../../lib/essayApi';
import { ensureEssayFonts, fontOf, pageStyle, themeOf } from './essayTheme';

type Props = {
  title: string;
  body: string;
  bgKey: string;
  bgImageUrl?: string | null;
  fontKey: string;
  /** 지면 상단 우측(진행상황 등) */
  corner?: ReactNode;
  /** 본문 아래(별점·확정 버튼 등) */
  footer?: ReactNode;
  /** 관리화면 미리보기: 화면 전체가 아니라 카드 안에 담는다 */
  embedded?: boolean;
};

export default function EssayPaper({ title, body, bgKey, bgImageUrl, fontKey, corner, footer, embedded }: Props) {
  useEffect(ensureEssayFonts, []);
  const theme = themeOf(bgKey);
  const font = fontOf(fontKey);
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim() !== '');
  // 작품별 업로드 이미지가 우선, 없으면 사진 프리셋, 그것도 없으면 CSS 프리셋
  const imageUrl = bgImageUrl ?? (theme.photo ? bgUrl(theme.photo) : null);

  // 사진 배경은 background-attachment:fixed 대신 고정 레이어로 깐다.
  // iOS 사파리가 fixed 첨부를 제대로 그리지 못해 이미지가 확대되거나 튀기 때문(지인 대부분 폰으로 본다).
  const fixedPhoto = !embedded && imageUrl;

  return (
    <div
      style={{
        ...(fixedPhoto ? { background: theme.base ?? '#efe9e0' } : pageStyle(theme, imageUrl)),
        position: 'relative',
        minHeight: embedded ? 420 : '100vh',
        padding: embedded ? '28px 16px' : 'clamp(28px, 6vh, 64px) 16px clamp(40px, 8vh, 88px)',
        borderRadius: embedded ? 12 : 0,
        overflow: embedded ? 'auto' : undefined,
        maxHeight: embedded ? '70vh' : undefined,
      }}
    >
      {fixedPhoto && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 0,
            backgroundImage: `${theme.overlay ?? 'linear-gradient(rgba(0,0,0,0.12), rgba(0,0,0,0.12))'}, url(${JSON.stringify(imageUrl)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      <div style={{ maxWidth: 720, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        {corner && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10, color: theme.soft, fontSize: 12.5 }}>
            {corner}
          </div>
        )}

        <article
          style={{
            ...theme.sheet,
            borderRadius: 14,
            padding: 'clamp(26px, 5vw, 54px) clamp(22px, 5vw, 48px)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
        >
          <h1
            style={{
              margin: '0 0 6px',
              fontFamily: font.family,
              fontSize: 'clamp(22px, 3.4vw, 30px)',
              fontWeight: 700,
              color: theme.ink,
              letterSpacing: '-0.01em',
              lineHeight: 1.4,
              textAlign: 'center',
            }}
          >
            {title}
          </h1>
          <div
            aria-hidden
            style={{ width: 46, height: 1, background: theme.soft, opacity: 0.55, margin: '18px auto clamp(22px, 4vh, 36px)' }}
          />

          <div style={{ fontFamily: font.family, color: theme.ink }}>
            {paragraphs.map((p, i) => (
              <p
                key={i}
                style={{
                  margin: i === 0 ? 0 : '1.15em 0 0',
                  fontSize: font.size,
                  lineHeight: font.lineHeight,
                  letterSpacing: font.letterSpacing,
                  textIndent: '1em',
                  wordBreak: 'keep-all',
                  overflowWrap: 'anywhere',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {p}
              </p>
            ))}
          </div>
        </article>

        {footer && <div style={{ marginTop: 22 }}>{footer}</div>}
      </div>
    </div>
  );
}

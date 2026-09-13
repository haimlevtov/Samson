import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { createServerDb, currentUser } from '@/src/db/server';
import { TabBar } from '@/src/ui/TabBar';
import { themeAttribute } from '@/src/ui/theme';
import './globals.css';

/**
 * The one display face — ADR 0033 §2, as amended: the files are in `app/fonts/`,
 * with the SIL Open Font License they must travel with, so neither a build nor a
 * browser asks Google for anything.
 *
 * WHY three faces: these are Google's own `latin`, `latin-ext` and `vietnamese`
 * subsets, and each must answer only for its own characters — `next/font/local`
 * cannot give files of ONE face different ranges. The ranges below are the ones
 * Google serves the files with, so a Latin-only page downloads only the first.
 * `next/font/google` fetched all three; FOUND IN REVIEW, the first version of this
 * committed two and drew "Nguyễn" with an Arial "ễ". Provenance and hashes:
 * `app/fonts/SOURCE.md`.
 *
 * WHY `adjustFontFallback: false` on all three: each would otherwise bring its own
 * metric-adjusted Arial, and the first of those would catch every extended-Latin
 * glyph before the other faces were reached. One fallback, with the metrics
 * `next/font` computed for this font, follows all three in `--display` in
 * globals.css.
 *
 * AI-NOTE: replacing the font means replacing the files, their rows in
 *          app/fonts/SOURCE.md, their pinned hashes in the invariant test, these
 *          ranges and that fallback's metrics together.
 */
const displayLatin = localFont({
  src: './fonts/bricolage-grotesque-latin.woff2',
  weight: '200 800',
  display: 'swap',
  variable: '--font-display-latin',
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const displayLatinExt = localFont({
  src: './fonts/bricolage-grotesque-latin-ext.woff2',
  weight: '200 800',
  display: 'swap',
  variable: '--font-display-latin-ext',
  adjustFontFallback: false,
  // Only a page with extended-Latin text downloads it; nothing to preload.
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
});

const displayVietnamese = localFont({
  src: './fonts/bricolage-grotesque-vietnamese.woff2',
  weight: '200 800',
  display: 'swap',
  variable: '--font-display-vietnamese',
  adjustFontFallback: false,
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    },
  ],
});

export const metadata = {
  title: 'Samson',
  description: 'Gamified strength training with an LLM coach.',
};

/**
 * WHY declared rather than left to the framework default: `viewportFit: 'cover'`
 * is what makes `env(safe-area-inset-*)` report real values on a notched phone,
 * and `app/globals.css` uses those to keep the pinned rest bar clear of the
 * home indicator. Without it the insets are all zero and the bar sits under
 * it — see docs/specs/mobile-interface.md §3.
 *
 * maximumScale is deliberately absent. Blocking zoom fails WCAG 1.4.4 and the
 * 16px input rule already removes the reason people reach for it.
 */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

/**
 * WHY the layout reads the database: the theme has to be on `<html>` in the
 * markup the server sends, not applied afterwards. Anything that lands later —
 * a script, an effect, a client component — paints the wrong theme first and
 * corrects it, which is a white flash on every navigation for a dark-mode user.
 *
 * A signed-out visitor has no row and no preference, so 'system' applies and
 * nothing is stamped.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const db = await createServerDb();
  const user = await currentUser(db);
  const theme = themeAttribute(user?.theme ?? 'system');

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${displayLatin.variable} ${displayLatinExt.variable} ${displayVietnamese.variable}`}
    >
      <body>
        <div className="shell">{children}</div>
        {/* Outside the shell: it is fixed to the viewport, not to the page. */}
        <TabBar />
      </body>
    </html>
  );
}

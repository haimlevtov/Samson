import type { ReactNode } from 'react';
import { Bricolage_Grotesque } from 'next/font/google';
import { createServerDb, currentUser } from '@/src/db/server';
import { TabBar } from '@/src/ui/TabBar';
import { themeAttribute } from '@/src/ui/theme';
import './globals.css';

/**
 * The one display face — ADR 0033 §2.
 *
 * `next/font` downloads it at BUILD time and serves it from this origin, so no
 * user's browser asks Google for anything. It sets `--font-display` on <html>;
 * `app/globals.css` names it with a system fallback, so a font that has not
 * arrived costs a heading its face and never its text.
 */
const display = Bricolage_Grotesque({
  subsets: ['latin', 'latin-ext'],
  axes: ['opsz'],
  variable: '--font-display',
  display: 'swap',
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
    <html lang="en" data-theme={theme} className={display.variable}>
      <body>
        <div className="shell">{children}</div>
        {/* Outside the shell: it is fixed to the viewport, not to the page. */}
        <TabBar />
      </body>
    </html>
  );
}

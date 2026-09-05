import type { ReactNode } from 'react';
import { TabBar } from '@/src/ui/TabBar';
import './globals.css';

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">{children}</div>
        {/* Outside the shell: it is fixed to the viewport, not to the page. */}
        <TabBar />
      </body>
    </html>
  );
}

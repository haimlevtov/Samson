import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Samson',
  description: 'Gamified strength training with an LLM coach.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}

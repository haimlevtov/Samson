import type { ReactNode } from 'react';

export const metadata = {
  title: 'Samson',
  description: 'Gamified strength training with an LLM coach.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

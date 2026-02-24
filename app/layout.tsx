import type { Metadata, Viewport } from 'next';
import './globals.css';
import { NativeSystemUi } from '@/src/frontend/components/system/NativeSystemUi';

export const metadata: Metadata = {
  title: 'AutoZap',
  description: 'AutoZap - atendimento WhatsApp com API oficial',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

type RootLayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <NativeSystemUi />
        {children}
      </body>
    </html>
  );
}

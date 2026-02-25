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
  const themeInitScript = `
    (function () {
      try {
        var key = 'AUTOZAP_THEME';
        var stored = localStorage.getItem(key);
        var theme = stored === 'dark' || stored === 'light'
          ? stored
          : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.style.colorScheme = theme;
      } catch (_) {}
    })();
  `;

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <NativeSystemUi />
        {children}
      </body>
    </html>
  );
}

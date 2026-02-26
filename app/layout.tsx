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
      <head>
        <meta name="color-scheme" content="dark light" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body {
                margin: 0;
                padding: 0;
                min-height: 100%;
                background: #09111c;
                color: #e2ecf8;
              }
              html[data-theme='dark'], html[data-theme='dark'] body {
                background: #09111c;
                color: #e2ecf8;
              }
              html[data-theme='light'], html[data-theme='light'] body {
                background: #e9eff7;
                color: #102a43;
              }
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <NativeSystemUi />
        {children}
      </body>
    </html>
  );
}

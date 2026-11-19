import type { Metadata, Viewport } from "next";
import { ThemeProvider, IntlProviderWrapper } from "@/components";
import { AuthProvider } from "@/providers/AuthProvider";
import "./globals.css";

// Primary Arabic font is "Glass Flowers 3D 2" loaded via @font-face in globals.css

export const metadata: Metadata = {
  title: "Rasmalak CRM | راسمالك",
  description: "Customer, sales and business management for small businesses. إدارة العملاء والمبيعات والأعمال للشركات الصغيرة.",
  applicationName: "Rasmalak CRM",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Rasmalak CRM",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "ar_JO",
    alternateLocale: "en_US",
    siteName: "Rasmalak CRM",
    title: "Rasmalak CRM",
    description: "Customer, sales and business management for small businesses.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#2D6A4F",
  viewportFit: "cover",
};

// Sets lang, dir and theme before React hydrates so the first paint is already correct.
// Arabic, right-to-left and the dark theme are the defaults when no preference has been saved.
const initScript = `
(function() {
  var root = document.documentElement;
  var language = 'ar';
  var theme = 'dark';
  try {
    var stored = localStorage.getItem('rasmalak-storage');
    var parsed = stored ? JSON.parse(stored) : {};
    var state = parsed.state || {};
    if (state.language === 'en' || state.language === 'ar') language = state.language;
    // Saved themes count from version 1, when dark became the default (see useStore).
    if ((parsed.version || 0) >= 1 && (state.theme === 'dark' || state.theme === 'light')) theme = state.theme;
  } catch (e) {}
  root.lang = language;
  root.dir = language === 'ar' ? 'rtl' : 'ltr';
  root.setAttribute('data-theme', theme);
  if (theme === 'dark') root.classList.add('dark');
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className="antialiased">
        {/* Soft mesh gradient background */}
        <div className="mesh-gradient-bg" aria-hidden="true" />
        <AuthProvider>
          <ThemeProvider>
            <IntlProviderWrapper>
              <div className="soft-surface">
                {children}
              </div>
            </IntlProviderWrapper>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

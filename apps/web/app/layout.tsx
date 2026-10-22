import type { Metadata } from "next";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  // Solo se usan 700 (tool) y 800 (wordmark + bola 8). Pedir 400/600
  // descargaba 2 archivos woff2 extra que nadie usa.
  weight: ["700", "800"],
  variable: "--font-sora",
  display: "swap",
  preload: true,
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: "the8bureau MAPS LEAD EXTRACTOR",
  description:
    "Plataforma para encontrar leads locales y auditar presencia digital de negocios.",
  icons: {
    icon: "/icon",
    shortcut: "/icon",
    apple: "/icon",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      data-theme="dark"
      suppressHydrationWarning
      className={`${sora.variable} ${ibmPlexMono.variable}`}
    >
      <head>
        <link rel="icon" href="/icon" />
        <link rel="shortcut icon" href="/icon" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem("t8b_theme_mode");if(!m){var l=localStorage.getItem("theme");m=(l==="light")?"light":"terminal";}var t=(m==="light")?"light":"dark";var d=document.documentElement;d.dataset.theme=t;d.setAttribute("data-mode",m);document.body&&document.body.setAttribute("data-theme",t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}



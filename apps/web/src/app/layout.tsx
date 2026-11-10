import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { LanguageProvider } from "@/lib/i18n";
import "./globals.css";

export const metadata = {
  title: "DigiEurope · Wohnsitzanmeldung (Prototyp)",
  description: "Prototyp: Wohnsitzanmeldung online mit Sofort-Prüfung, Statusverfolgung und Sachbearbeitungs-Ansicht.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <LanguageProvider>
          <Header />
          <main id="main" className="container page">{children}</main>
          <footer className="site-footer">
            <div className="container">DigiEurope · Prototype · Musterstadt is a fictional municipality.</div>
          </footer>
        </LanguageProvider>
      </body>
    </html>
  );
}

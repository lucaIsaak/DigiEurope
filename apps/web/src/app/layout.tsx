import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { LanguageProvider } from "@/lib/i18n";
import { StaffProvider } from "@/lib/staff";
import { ThemeProvider } from "@/lib/theme";
import "./globals.css";

export const metadata = {
  title: "Studierendenwerk Musterstadt · BAföG Ausland digital",
  description: "Auslands-BAföG: Unterlagen hochladen, in Minuten sehen was fehlt, voraussichtliche Förderung erfahren. Fiktives Amt für ein Studienprojekt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        {/* Applies a saved theme before first paint, so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('ms.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}" }} />
      </head>
      <body>
        <ThemeProvider>
          <LanguageProvider>
            <StaffProvider>
              <Shell>{children}</Shell>
            </StaffProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

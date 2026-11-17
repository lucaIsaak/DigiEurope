import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { LanguageProvider } from "@/lib/i18n";
import { StaffProvider } from "@/lib/staff";
import "./globals.css";

export const metadata = {
  title: "Studierendenwerk Musterstadt · BAföG Ausland digital",
  description: "Auslands-BAföG: Unterlagen hochladen, in Minuten sehen was fehlt, voraussichtliche Förderung erfahren. Fiktives Amt für ein Studienprojekt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <LanguageProvider>
          <StaffProvider>
            <Shell>{children}</Shell>
          </StaffProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

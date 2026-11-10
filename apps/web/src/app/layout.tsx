import type { ReactNode } from "react";

export const metadata = {
  title: "DigiEurope",
  description: "Prototyp einer Plattform zur Digitalisierung von Verwaltungsleistungen",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}

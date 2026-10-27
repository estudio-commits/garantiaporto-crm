import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  icons: { icon: "/brand/icon.svg" },
  title: "Garantía Porto · CRM",
  description: "Panel privado de gestión de solicitudes",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-UY">
      <body>{children}</body>
    </html>
  );
}

import "./globals.css";

export const metadata = {
  title: "Sketchers Media CRM",
  description: "Internal CRM dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

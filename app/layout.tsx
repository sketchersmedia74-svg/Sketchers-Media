import "./globals.css";
import RegisterServiceWorker from "./components/RegisterServiceWorker";
import PhoneProvider from "./components/phone/PhoneProvider";

export const metadata = {
  title: "Reset Dental Media CRM",
  description: "Internal CRM dashboard",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Reset Dental CRM",
  },
};

export const viewport = {
  themeColor: "#5C1A2E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme', t || (d ? 'dark' : 'light'));}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <RegisterServiceWorker />
        <PhoneProvider>{children}</PhoneProvider>
      </body>
    </html>
  );
}

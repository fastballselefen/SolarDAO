import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <title>SolarDAO - 光伏发电共享账本</title>
      </head>
      <body style={{ margin: 0, backgroundColor: '#0f172a' }}>{children}</body>
    </html>
  );
}




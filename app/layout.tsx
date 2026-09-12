import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anima · 情绪生命体",
  description:
    "与一个拥有内部状态、记忆与不可解释性的情绪生命体，进行 90 秒自由交互。结束后获得一句诗，与双方动作的客观记录。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

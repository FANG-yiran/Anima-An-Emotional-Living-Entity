import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anima · 情绪生命体交互评估",
  description:
    "与一个拥有内部状态、记忆与不可解释性的情绪生命体，进行 90 秒自由交互。结束后获得一面关系之镜——情感联结评分、关键词与七维关系画像。",
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

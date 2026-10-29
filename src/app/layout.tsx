import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AirGuard | Smart Air • Smart Health",
  description:
    "Understand air quality, explore pollution trends, and make healthier everyday choices with AirGuard.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

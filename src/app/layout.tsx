import type { Metadata, Viewport } from "next"
import { Anton, Geist_Mono, Roboto_Flex } from "next/font/google"
import { Preloader } from "@/components/preloader"
import "./globals.css"

const robotoFlex = Roboto_Flex({ variable: "--font-roboto-flex", subsets: ["latin"], weight: ["100", "400", "500", "600", "700", "800"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })
const anton = Anton({ variable: "--font-anton-face", subsets: ["latin"], weight: "400" })

const title = "WhoJoshi — AI news, one card at a time"
const description = "A fast, keyboard-first reader for WhoJoshi and The Code."

// Icons (favicon.ico, icon.svg, apple-icon.png) and the share card (opengraph-image.tsx)
// are picked up from this folder by file convention.
// Share cards need absolute image URLs. Set NEXT_PUBLIC_SITE_URL for a custom domain;
// on Vercel the production domain is used automatically.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000")

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: "WhoJoshi",
  appleWebApp: { title: "WhoJoshi" },
  openGraph: { type: "website", siteName: "WhoJoshi", title, description },
  twitter: { card: "summary_large_image", title, description },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // draw under the notch / home indicator; safe-area insets are padded in the UI
  themeColor: "#0b0b0b", // dark by default
}

// Dark by default; only a theme the user picked (stored by the toggle) overrides it.
const themeScript = `try{if(localStorage.getItem("theme")==="light")document.documentElement.classList.remove("dark")}catch(e){}`

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${robotoFlex.variable} ${geistMono.variable} ${anton.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full overflow-hidden">
        <Preloader />
        {children}
      </body>
    </html>
  )
}

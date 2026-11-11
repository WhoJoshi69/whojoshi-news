import type { Metadata, Viewport } from "next"
import { Anton, Geist_Mono, Roboto_Flex } from "next/font/google"
import { Preloader } from "@/components/preloader"
import "./globals.css"

const robotoFlex = Roboto_Flex({ variable: "--font-roboto-flex", subsets: ["latin"], weight: ["100", "400", "500", "600", "700", "800"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })
const anton = Anton({ variable: "--font-anton-face", subsets: ["latin"], weight: "400" })

export const metadata: Metadata = {
  title: "Brief — AI news, one card at a time",
  description: "A fast, keyboard-first reader for WhoJoshi and The Code.",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" },
  ],
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

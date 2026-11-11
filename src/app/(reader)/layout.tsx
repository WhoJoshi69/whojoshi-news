import { Reader } from "@/components/reader"

// The reader lives in the layout so its loaded issues, position and animations survive
// moving between dates (/ → /2026-11-10 → …). Pages only validate the URL.
export default function ReaderLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Reader />
      {children}
    </>
  )
}

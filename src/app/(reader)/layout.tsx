import { Suspense } from "react"
import { Reader } from "@/components/reader"

// The reader lives in the layout so its loaded issues, position and animations survive
// moving between dates (/ → /2026-11-10 → …). Pages only validate the URL.
//
// Both are wrapped in <Suspense>: the date comes from the URL (runtime data), so with
// cacheComponents the static shell is the fallback and the reader streams in at request time.
// The WHOJOSHI preloader covers the page while that happens.
export default function ReaderLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense fallback={<div className="h-dvh bg-background" />}>
        <Reader />
      </Suspense>
      <Suspense fallback={null}>{children}</Suspense>
    </>
  )
}

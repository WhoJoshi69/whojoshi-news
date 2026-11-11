"use client"

// Ported from darshit.joshi/components/Preloader.tsx — same timeline, text set to WHOJOSHI.
import { useRef } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"

gsap.registerPlugin(useGSAP)

export function Preloader({ text = "WHOJOSHI" }: { text?: string }) {
  const preloaderRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: "power1.inOut" } })

      // 1) Reveal each letter
      tl.to(".name-text span", { y: 0, stagger: 0.05, duration: 0.2 })

      // 2) Slide out the preloader items
      tl.to(".preloader-item", { delay: 1, y: "100%", duration: 0.5, stagger: 0.1 })
        // 3) Fade out letters
        .to(".name-text span", { autoAlpha: 0 }, "<0.5")
        // 4) Fade out the container
        .to(preloaderRef.current, { autoAlpha: 0 }, "<1")
    },
    { scope: preloaderRef },
  )

  return (
    <div className="fixed inset-0 z-[60] flex" ref={preloaderRef} aria-hidden>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="preloader-item h-full w-[10%] bg-black" />
      ))}

      <p className="name-text absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 overflow-hidden text-center font-anton text-[18vw] leading-none text-white lg:text-[200px]">
        {text.split("").map((char, i) => (
          <span key={i} className="inline-block translate-y-full">
            {char}
          </span>
        ))}
      </p>
    </div>
  )
}

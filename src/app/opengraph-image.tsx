import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ImageResponse } from "next/og"

// Link-preview card (WhatsApp, Slack, X, iMessage, LinkedIn…): the WHOJOSHI banner on black.
export const alt = "WhoJoshi — AI news, one card at a time"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const GREEN = "#5cfc2e"

export default async function OpengraphImage() {
  const banner = await readFile(join(process.cwd(), "public/whojoshi.png"))
  const src = `data:image/png;base64,${banner.toString("base64")}`

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(ellipse at 50% 45%, #0f2a0c 0%, #050805 65%)",
          position: "relative",
        }}
      >
        {/* 2167×726 banner scaled to 1080 wide */}
        <img src={src} width={1080} height={362} alt="" />
        <div
          style={{
            marginTop: 36,
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 34,
            color: "#d9e8d4",
            letterSpacing: 1,
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 7, background: GREEN }} />
          AI news, one card at a time
          <div style={{ width: 14, height: 14, borderRadius: 7, background: GREEN }} />
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 8, background: GREEN }} />
      </div>
    ),
    size,
  )
}

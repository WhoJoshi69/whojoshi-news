import * as cheerio from "cheerio"
import type { AnyNode, Element } from "domhandler"

export const SOURCES = {
  superhuman: { name: "WhoJoshi", short: "WhoJoshi", base: "https://www.superhuman.ai" },
  code: { name: "The Code", short: "The Code", base: "https://codenewsletter.ai" },
} as const

export type SourceId = keyof typeof SOURCES

export function isSource(s: string | null): s is SourceId {
  return !!s && s in SOURCES
}

export type IssueMeta = {
  source: SourceId
  slug: string
  title: string
  subtitle: string
  date: string
  image: string | null
  url: string
}

export type Story = {
  kicker: string | null
  title: string
  html: string
  image: string | null
  sponsored: boolean
}

export type Issue = IssueMeta & { stories: Story[] }

/* ---------------- tiny TTL cache + fetch ---------------- */

const cache = new Map<string, { at: number; value: unknown }>()
const TTL = 10 * 60 * 1000

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value as T
  const value = await fn()
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 300) cache.delete(cache.keys().next().value!)
  return value
}

async function getHtml(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      accept: "text/html",
    },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.text()
}

/* ---------------- archive listing ---------------- */

const STR = `((?:[^"\\\\]|\\\\.)*)`
const POST_RE = new RegExp(
  `"web_title":"${STR}","web_subtitle":"${STR}"[^{}]*?"override_scheduled_at":(?:"${STR}"|null),"slug":"${STR}"[^{}]*?"scheduled_at":"${STR}","image_url":(?:"${STR}"|null)`,
  "g",
)

const unescape = (s: string | undefined) => {
  if (!s) return ""
  try {
    return JSON.parse(`"${s}"`) as string
  } catch {
    return s
  }
}

export function listIssues(source: SourceId, page = 1): Promise<IssueMeta[]> {
  return cached(`list:${source}:${page}`, async () => {
    const { base } = SOURCES[source]
    const html = await getHtml(`${base}/archive?page=${page}`)
    const seen = new Set<string>()
    const out: IssueMeta[] = []
    for (const m of html.matchAll(POST_RE)) {
      const [, title, subtitle, override, slug, scheduled, image] = m
      if (seen.has(slug)) continue
      seen.add(slug)
      out.push({
        source,
        slug,
        title: unescape(title),
        subtitle: unescape(subtitle),
        date: override || scheduled,
        image: image ? unescape(image) : null,
        url: `${base}/p/${slug}`,
      })
    }
    return out.sort((a, b) => +new Date(b.date) - +new Date(a.date))
  })
}

/* ---------------- issue parsing ---------------- */

const KEEP = new Set([
  "p", "a", "strong", "b", "em", "i", "u", "s", "code", "pre", "ul", "ol", "li",
  "h3", "h4", "h6", "blockquote", "br", "hr", "table", "thead", "tbody", "tr", "td", "th",
  "sup", "sub", "mark",
])
const DROP = new Set(["script", "style", "noscript", "svg", "button", "form", "input", "source", "iframe", "video", "h5"])

function hiRes(src: string) {
  // beehiiv CDN — ask for a sensible width for crisp but light images
  return src.includes("width=") ? src : src.replace("fit=scale-down,", "fit=scale-down,width=1200,")
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function clean($: cheerio.CheerioAPI, nodes: AnyNode[]): string {
  let out = ""
  for (const node of nodes) {
    if (node.type === "text") {
      out += esc((node as unknown as { data: string }).data)
      continue
    }
    if (node.type !== "tag") continue
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (DROP.has(tag)) continue
    const kids = clean($, el.children as AnyNode[])

    if (tag === "img") {
      const src = el.attribs.src
      if (!src) continue
      const w = el.attribs.width, h = el.attribs.height
      if (w && h && Number(w) / Number(h) > 12) continue // decorative divider strip
      out += `<img src="${esc(hiRes(src))}" alt="${esc(el.attribs.alt || "")}" loading="lazy"${
        w && h ? ` width="${esc(w)}" height="${esc(h)}"` : ""
      }/>`
      continue
    }
    if (tag === "small") {
      if (kids.trim()) out += `<figcaption>${kids}</figcaption>`
      continue
    }
    if (tag === "picture") {
      out += kids
      continue
    }
    if (tag === "a") {
      const href = el.attribs.href || ""
      if (!/^https?:/.test(href)) {
        out += kids
        continue
      }
      out += `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${kids}</a>`
      continue
    }
    if (tag === "h1" || tag === "h2") {
      if (kids.trim()) out += `<h3>${kids}</h3>`
      continue
    }
    if (KEEP.has(tag)) {
      if (["p", "li", "h3", "h4", "h6", "blockquote", "strong", "em", "b", "i", "span"].includes(tag) && !kids.trim()) continue
      out += `<${tag}>${kids}</${tag}>`
      continue
    }
    out += kids // unwrap div/span/etc
  }
  return out
}

const text = (s: string) => s.replace(/\s+/g, " ").trim()

const isNoise = (t: string) =>
  /Login or Subscribe to participate|What did you think of today|Your feedback helps|Update your email preferences|Sign up for free|Already a subscriber/i.test(
    t,
  )

export function getIssue(source: SourceId, slug: string): Promise<Issue> {
  return cached(`issue:${source}:${slug}`, async () => {
    const { base } = SOURCES[source]
    const url = `${base}/p/${slug}`
    const html = await getHtml(url)
    const $ = cheerio.load(html)

    const meta = (p: string) => $(`meta[property="${p}"]`).attr("content") || ""
    const title = meta("og:title") || $("title").text()
    const subtitle = meta("og:description")
    const date = meta("article:published_time")
    const ogImage = meta("og:image") || null

    let root = $("#content-blocks").children().first()
    while (root.children().length === 1) root = root.children().first()

    type Draft = { kicker: string | null; title: string; parts: string[]; pending: string[] }
    const stories: Draft[] = []
    let cur: Draft = { kicker: null, title, parts: [], pending: [] }
    let orphanImages: string[] = [] // image-only blocks that precede a section header

    root.children().each((_, block) => {
      const $b = $(block)
      const t = text($b.text())
      if (isNoise(t)) {
        // keep polls etc. out, but still keep any image inside a quiz block
        if (!/Which one is AI generated|Spot the fake/i.test(t)) return
      }

      const h5 = $b.find("h5").first()
      if (h5.length) {
        stories.push(cur)
        const kicker = text(h5.text())
        const h2 = $b.find("h2").first()
        cur = {
          kicker,
          title: h2.length ? text(h2.text()) : "",
          parts: [...orphanImages],
          pending: [],
        }
        orphanImages = []
        // anything else in the header block besides h5/h2 (rare)
        $b.find("h5, h2").remove()
        const rest = clean($, [block])
        if (text(cheerio.load(rest).text())) cur.parts.push(rest)
        return
      }

      const cleaned = clean($, [block])
      if (!cleaned.trim()) return
      const onlyImage = !t && $b.find("img").length > 0
      const isFirst = !stories.length && !cur.parts.length && !orphanImages.length
      if (onlyImage && isFirst && source === "superhuman") {
        // swap the issue's header label banner for the WhoJoshi banner
        orphanImages.push(`<img src="/whojoshi.png" alt="WhoJoshi — Darshit Joshi &amp; Team" width="2167" height="726"/>`)
        return
      }
      if (onlyImage && ($b.is("[class*=imageB]") || $b.find("[class*=imageB]").length)) {
        orphanImages.push(cleaned)
        return
      }
      cur.parts.push(...orphanImages, cleaned)
      orphanImages = []
    })
    if (orphanImages.length) cur.parts.push(...orphanImages)
    stories.push(cur)

    const out: Story[] = stories
      .map((s, i): Story => {
        let body = s.parts.join("")
        // Use first strong/paragraph as title when section has none
        let storyTitle = s.title
        if (!storyTitle && i === 0) storyTitle = title
        if (!storyTitle) {
          const $s = cheerio.load(body, null, false)
          const firstStrong = text($s("p strong").first().text()).replace(/[:.]$/, "")
          const k = (s.kicker ?? "").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
          storyTitle = firstStrong.length >= 12 && firstStrong.length < 120 ? firstStrong : k
        }
        const imgMatch = body.match(/<img src="([^"]+)"/)
        const kicker = s.kicker ? s.kicker.replace(/\s+/g, " ") : i === 0 ? "Intro" : null
        body = body.replace(/<p>\s*<\/p>/g, "")
        return {
          kicker,
          title: storyTitle,
          html: body,
          image: imgMatch ? imgMatch[1] : null,
          sponsored: /presented by|sponsored|together with|partner/i.test(kicker ?? ""),
        }
      })
      .filter((s) => !s.sponsored)
      .filter((s) => text(cheerio.load(s.html).text()).length > 0 || s.image)
      // drop trailing "EXTRAS"-only fluff with no real text
      .filter((s) => !(s.kicker && /^extras$/i.test(s.kicker) && text(cheerio.load(s.html).text()).length < 40))

    return {
      source,
      slug,
      title,
      subtitle,
      date,
      image: ogImage,
      url,
      stories: out,
    }
  })
}

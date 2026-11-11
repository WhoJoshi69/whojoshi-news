"use client"
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/immutability */

import * as React from "react"
import { AnimatePresence, motion, MotionConfig, useMotionValue, useSpring, type PanInfo } from "motion/react"
import { ArrowUpRight, ChevronLeft, ChevronRight, Keyboard, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import Aurora from "@/components/aurora"

/* ---------------- types ---------------- */

type SourceId = "superhuman" | "code"
type Filter = "all" | SourceId

type IssueMeta = {
  source: SourceId
  slug: string
  title: string
  subtitle: string
  date: string
  image: string | null
  url: string
}
type Story = { kicker: string | null; title: string; html: string; image: string | null; sponsored: boolean }
type Issue = IssueMeta & { stories: Story[] }

type ListState = { issues: IssueMeta[]; page: number; done: boolean; loading: boolean }
type Loaded = Issue | "loading" | "error"

const SOURCE_LABEL: Record<SourceId, string> = { superhuman: "WhoJoshi", code: "The Code" }
const SOURCE_DOT: Record<SourceId, string> = { superhuman: "bg-lime-400", code: "bg-sky-400" }
const FILTERS: { id: Filter; label: string; key: string }[] = [
  { id: "all", label: "All", key: "0" },
  { id: "superhuman", label: "WhoJoshi", key: "1" },
  { id: "code", label: "The Code", key: "2" },
]

const keyOf = (i: { source: SourceId; slug: string }) => `${i.source}:${i.slug}`

const fmtDate = (d: string) => {
  const date = new Date(d)
  if (isNaN(+date)) return ""
  const days = Math.floor((Date.now() - +date) / 864e5)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined })
}

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v)
    } catch {}
  },
}

/* ---------------- reader ---------------- */

export function Reader() {
  const [lists, setLists] = React.useState<Record<SourceId, ListState>>({
    superhuman: { issues: [], page: 0, done: false, loading: false },
    code: { issues: [], page: 0, done: false, loading: false },
  })
  const [loaded, setLoaded] = React.useState<Record<string, Loaded>>({})
  const [filter, setFilter] = React.useState<Filter>("all")
  const [cur, setCur] = React.useState<{ key: string | null; story: number }>({ key: null, story: 0 })
  const [dir, setDir] = React.useState(1)
  const [help, setHelp] = React.useState(false)
  const [dark, setDark] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const listsRef = React.useRef(lists)
  listsRef.current = lists
  const loadedRef = React.useRef(loaded)
  loadedRef.current = loaded

  /* ---- boot ---- */
  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"))
    const f = store.get("filter") as Filter | null
    if (f && FILTERS.some((x) => x.id === f)) setFilter(f)
  }, [])

  /* ---- data loading ---- */
  const loadPage = React.useCallback(async (source: SourceId) => {
    const st = listsRef.current[source]
    if (st.loading || st.done) return
    const page = st.page + 1
    setLists((l) => ({ ...l, [source]: { ...l[source], loading: true } }))
    try {
      const res = await fetch(`/api/issues?source=${source}&page=${page}`)
      const { issues } = (await res.json()) as { issues: IssueMeta[] }
      setLists((l) => {
        const seen = new Set(l[source].issues.map((i) => i.slug))
        const fresh = (issues ?? []).filter((i) => !seen.has(i.slug))
        return {
          ...l,
          [source]: { issues: [...l[source].issues, ...fresh], page, done: fresh.length === 0, loading: false },
        }
      })
    } catch {
      setLists((l) => ({ ...l, [source]: { ...l[source], loading: false } }))
    }
  }, [])

  const loadIssue = React.useCallback(async (meta: IssueMeta) => {
    const k = keyOf(meta)
    const s = loadedRef.current[k]
    if (s && s !== "error") return
    setLoaded((m) => ({ ...m, [k]: "loading" }))
    try {
      const res = await fetch(`/api/issue?source=${meta.source}&slug=${meta.slug}`)
      if (!res.ok) throw new Error()
      const issue = (await res.json()) as Issue
      setLoaded((m) => ({ ...m, [k]: issue }))
      // warm the image cache for the first couple of stories
      issue.stories.slice(0, 3).forEach((s) => s.image && (new Image().src = s.image))
    } catch {
      setLoaded((m) => ({ ...m, [k]: "error" }))
    }
  }, [])

  React.useEffect(() => {
    loadPage("superhuman")
    loadPage("code")
  }, [loadPage])

  /* ---- derived feed ---- */
  const feed = React.useMemo(() => {
    const src: SourceId[] = filter === "all" ? ["superhuman", "code"] : [filter]
    return src.flatMap((s) => lists[s].issues).sort((a, b) => +new Date(b.date) - +new Date(a.date))
  }, [lists, filter])

  // fall back to the newest issue whenever the current one isn't in the feed (boot, filter change)
  const foundIdx = cur.key ? feed.findIndex((i) => keyOf(i) === cur.key) : -1
  const issueIdx = foundIdx === -1 ? (feed.length ? 0 : -1) : foundIdx
  const curKey = issueIdx >= 0 ? keyOf(feed[issueIdx]) : null
  const meta = issueIdx >= 0 ? feed[issueIdx] : null
  const issueState = meta ? loaded[keyOf(meta)] : undefined
  const issue = issueState && typeof issueState === "object" ? issueState : null
  const storyIdx = issue ? (cur.story < 0 ? issue.stories.length - 1 : Math.min(cur.story, issue.stories.length - 1)) : 0
  const story = issue?.stories[storyIdx]

  // fetch current + neighbours, and the next archive page near the end
  React.useEffect(() => {
    if (issueIdx < 0) return
    loadIssue(feed[issueIdx])
    if (feed[issueIdx + 1]) loadIssue(feed[issueIdx + 1])
    if (feed[issueIdx - 1]) loadIssue(feed[issueIdx - 1])
    if (issueIdx >= feed.length - 3) {
      ;(filter === "all" ? (["superhuman", "code"] as SourceId[]) : [filter]).forEach((s) => loadPage(s))
    }
  }, [issueIdx, feed, filter, loadIssue, loadPage])

  // preload next story's image
  React.useEffect(() => {
    const nxt = issue?.stories[storyIdx + 1]
    if (nxt?.image) new Image().src = nxt.image
  }, [issue, storyIdx])

  /* ---- navigation ---- */
  const next = React.useCallback(() => {
    if (!meta) return
    setDir(1)
    if (issue && storyIdx < issue.stories.length - 1) return setCur({ key: curKey, story: storyIdx + 1 })
    const n = feed[issueIdx + 1]
    if (n) setCur({ key: keyOf(n), story: 0 })
  }, [meta, issue, storyIdx, feed, issueIdx, curKey])

  const prev = React.useCallback(() => {
    if (!meta) return
    setDir(-1)
    if (storyIdx > 0) return setCur({ key: curKey, story: storyIdx - 1 })
    const p = feed[issueIdx - 1]
    if (p) setCur({ key: keyOf(p), story: -1 })
  }, [meta, storyIdx, feed, issueIdx, curKey])

  const jumpIssue = React.useCallback(
    (d: 1 | -1) => {
      const t = feed[issueIdx + d]
      if (!t) return
      setDir(d)
      setCur({ key: keyOf(t), story: 0 })
    },
    [feed, issueIdx],
  )

  const goStory = (i: number) => {
    setDir(i >= storyIdx ? 1 : -1)
    setCur({ key: curKey, story: i })
  }

  const changeFilter = React.useCallback((f: Filter) => {
    setFilter(f)
    store.set("filter", f)
    setDir(1)
    setCur((c) => (c.key && (f === "all" || c.key.startsWith(f + ":")) ? c : { key: null, story: 0 }))
  }, [])

  const toggleTheme = React.useCallback(() => {
    const d = !document.documentElement.classList.contains("dark")
    document.documentElement.classList.toggle("dark", d)
    store.set("theme", d ? "dark" : "light")
    setDark(d)
  }, [])

  /* ---- scroll progress ---- */
  const progress = useMotionValue(0)
  const smoothProgress = useSpring(progress, { stiffness: 300, damping: 40 })
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    progress.set(max > 4 ? el.scrollTop / max : 1)
  }
  React.useEffect(() => {
    progress.jump(0)
    smoothProgress.jump(0)
    requestAnimationFrame(onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey, storyIdx, !!issue])

  /* ---- keyboard ---- */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return
      const el = scrollRef.current
      const atBottom = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 4
      const atTop = !el || el.scrollTop <= 2

      switch (e.key) {
        case "ArrowRight":
        case "j":
        case "l":
          next()
          break
        case "ArrowLeft":
        case "k":
        case "h":
          prev()
          break
        case "ArrowDown":
          el?.scrollBy({ top: 120, behavior: "smooth" })
          break
        case "ArrowUp":
          el?.scrollBy({ top: -120, behavior: "smooth" })
          break
        case " ":
          if (e.shiftKey) {
            if (atTop) prev()
            else el?.scrollBy({ top: -el.clientHeight * 0.85, behavior: "smooth" })
          } else {
            if (atBottom) next()
            else el?.scrollBy({ top: el.clientHeight * 0.85, behavior: "smooth" })
          }
          break
        case "n":
        case "]":
          jumpIssue(1)
          break
        case "p":
        case "[":
          jumpIssue(-1)
          break
        case "g":
          setDir(-1)
          setCur({ key: curKey, story: 0 })
          break
        case "G":
          if (feed[0]) {
            setDir(-1)
            setCur({ key: keyOf(feed[0]), story: 0 })
          }
          break
        case "o":
        case "Enter":
          if (meta) window.open(meta.url, "_blank", "noopener")
          break
        case "0":
        case "1":
        case "2":
          changeFilter(FILTERS[Number(e.key)].id)
          break
        case "t":
          toggleTheme()
          break
        case "?":
          setHelp((h) => !h)
          break
        case "Escape":
          setHelp(false)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [next, prev, jumpIssue, changeFilter, toggleTheme, feed, meta, curKey])

  /* ---- swipe ---- */
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const swipe = info.offset.x + info.velocity.x * 0.2
    if (swipe < -90) next()
    else if (swipe > 90) prev()
  }

  const total = issue?.stories.length ?? 0
  const animKey = `${curKey}:${issue ? storyIdx : "loading"}`
  const hasNext = !!(issue && storyIdx < total - 1) || !!feed[issueIdx + 1]
  const hasPrev = storyIdx > 0 || issueIdx > 0

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate flex h-dvh flex-col items-center bg-background">
        {/* aurora background */}
        <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
          <Aurora
            colorStops={["#3B1CC9", "#4FCF3A", "#3B1CC9"]}
            lightMode={!dark}
            amplitude={1}
            blend={0.5}
            height={0.75}
            speed={1}
            glow={0.6}
            layers={2}
          />
        </div>

        {/* header */}
        <header className="relative z-10 flex w-full max-w-3xl items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-6">
          <div className="flex items-baseline gap-1 select-none">
            <span className="font-serif text-2xl leading-none tracking-tight">brief</span>
            <span className="font-serif text-2xl leading-none text-muted-foreground italic">.</span>
          </div>

          <nav className="flex items-center rounded-full border bg-card/60 p-1 backdrop-blur">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => changeFilter(f.id)}
                className={cn(
                  "relative rounded-full px-3 py-1 text-xs font-medium transition-colors sm:text-[0.8rem]",
                  filter === f.id ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {filter === f.id && (
                  <motion.span
                    layoutId="filter-pill"
                    className="absolute inset-0 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <span className="relative">{f.label}</span>
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" className="hidden sm:inline-flex">
              <Keyboard />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
        </header>

        {/* card stage */}
        <main className="relative z-10 flex w-full max-w-3xl min-h-0 flex-1 flex-col px-3 sm:px-6">
          {/* story segments */}
          <div className="mb-3 flex h-1 gap-1 px-1">
            {issue
              ? issue.stories.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => goStory(i)}
                    aria-label={`Story ${i + 1}: ${s.title}`}
                    className="group relative h-full flex-1 overflow-hidden rounded-full bg-foreground/10"
                  >
                    {i < storyIdx && <span className="absolute inset-0 bg-foreground/70" />}
                    {i === storyIdx && (
                      <motion.span
                        className="absolute inset-0 origin-left bg-foreground"
                        style={{ scaleX: smoothProgress }}
                      />
                    )}
                    <span className="absolute inset-0 bg-foreground/0 transition-colors group-hover:bg-foreground/20" />
                  </button>
                ))
              : Array.from({ length: 8 }).map((_, i) => <span key={i} className="flex-1 rounded-full bg-foreground/10" />)}
          </div>

          <div className="relative min-h-0 flex-1">
            <AnimatePresence initial={false} custom={dir} mode="popLayout">
              <motion.article
                key={animKey}
                custom={dir}
                variants={{
                  enter: (d: number) => ({ x: d * 56, opacity: 0, scale: 0.97, filter: "blur(6px)" }),
                  center: { x: 0, opacity: 1, scale: 1, filter: "blur(0px)" },
                  exit: (d: number) => ({ x: d * -56, opacity: 0, scale: 0.97, filter: "blur(6px)" }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.8 }}
                drag="x"
                dragDirectionLock
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.18}
                onDragEnd={onDragEnd}
                className="absolute inset-0 flex flex-col overflow-hidden rounded-3xl border border-foreground/10 bg-card/60 backdrop-blur-2xl shadow-[0_1px_0_0_color-mix(in_oklch,var(--foreground)_4%,transparent),0_30px_80px_-40px_rgba(0,0,0,0.45)]"
              >
                <div
                  ref={(el) => {
                    // during cross-fade the exiting card unmounts last — keep the newest one
                    if (el) scrollRef.current = el
                  }}
                  onScroll={(e) => e.currentTarget === scrollRef.current && onScroll()}
                  className="thin-scrollbar h-full overflow-y-auto overscroll-contain"
                >
                  {meta && story && issue ? (
                    <StoryView meta={meta} story={story} index={storyIdx} total={total} />
                  ) : issueState === "error" ? (
                    <ErrorView url={meta?.url} onRetry={() => meta && loadIssue(meta)} />
                  ) : (
                    <LoadingView meta={meta} />
                  )}
                </div>
              </motion.article>
            </AnimatePresence>
          </div>
        </main>

        {/* footer */}
        <footer className="relative z-10 flex w-full max-w-3xl items-center justify-between gap-3 px-4 pt-3 pb-4 sm:px-6">
          <Button variant="outline" size="icon-lg" className="rounded-full" onClick={prev} disabled={!hasPrev} aria-label="Previous">
            <ChevronLeft />
          </Button>

          <div className="min-w-0 flex-1 text-center">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={curKey ?? "none"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="truncate text-xs text-muted-foreground"
              >
                {meta ? (
                  <>
                    <span className="tabular-nums">
                      {total ? `${storyIdx + 1} / ${total}` : "…"}
                    </span>
                    <span className="mx-2 opacity-40">·</span>
                    <span>{meta.title}</span>
                  </>
                ) : (
                  "Loading issues…"
                )}
              </motion.div>
            </AnimatePresence>
            <div className="mt-1 hidden items-center justify-center gap-3 text-[11px] text-muted-foreground/70 sm:flex">
              <span className="flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> stories</span>
              <span className="flex items-center gap-1"><Kbd>N</Kbd><Kbd>P</Kbd> issues</span>
              <span className="flex items-center gap-1"><Kbd>Space</Kbd> read</span>
              <span className="flex items-center gap-1"><Kbd>?</Kbd> more</span>
            </div>
          </div>

          <Button size="icon-lg" className="rounded-full" onClick={next} disabled={!hasNext} aria-label="Next">
            <ChevronRight />
          </Button>
        </footer>

        <AnimatePresence>{help && <HelpOverlay onClose={() => setHelp(false)} />}</AnimatePresence>
      </div>
    </MotionConfig>
  )
}

/* ---------------- pieces ---------------- */

function StoryView({ meta, story, index, total }: { meta: IssueMeta; story: Story; index: number; total: number }) {
  const isIntro = index === 0
  return (
    <div className="mx-auto max-w-[44rem] px-5 pt-6 pb-16 sm:px-10 sm:pt-9">
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground/80">
          <span className={cn("size-1.5 rounded-full", SOURCE_DOT[meta.source])} />
          {SOURCE_LABEL[meta.source]}
        </span>
        <span className="opacity-40">·</span>
        <span>{fmtDate(meta.date)}</span>
        {story.kicker && !isIntro && (
          <>
            <span className="opacity-40">·</span>
            <span className="tracking-wider uppercase">{story.kicker}</span>
          </>
        )}
      </div>

      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, type: "spring", stiffness: 300, damping: 30 }}
        className={cn(
          "font-serif leading-[1.05] tracking-tight text-balance",
          isIntro ? "text-[2.6rem] sm:text-6xl" : "text-[2.1rem] sm:text-5xl",
        )}
      >
        {story.title}
      </motion.h1>
      {isIntro && meta.subtitle && (
        <p className="mt-3 text-lg text-muted-foreground text-pretty">{meta.subtitle}</p>
      )}

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 30 }}
        className="news-prose mt-7"
        dangerouslySetInnerHTML={{ __html: story.html }}
      />

      <div className="mt-12 flex items-center justify-center text-xs text-muted-foreground/60">
        {index < total - 1 ? (
          <span className="flex items-center gap-1.5">
            Press <Kbd>Space</Kbd> or <Kbd>J</Kbd> for the next story
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            End of issue · <Kbd>J</Kbd> continues to the next one
          </span>
        )}
      </div>
    </div>
  )
}

function LoadingView({ meta }: { meta: IssueMeta | null }) {
  return (
    <div className="mx-auto max-w-[44rem] px-5 pt-6 sm:px-10 sm:pt-9">
      <div className="mb-5 flex items-center gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-14" />
      </div>
      {meta ? (
        <h1 className="font-serif text-[2.6rem] leading-[1.05] tracking-tight text-balance text-foreground/40 sm:text-6xl">
          {meta.title}
        </h1>
      ) : (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      )}
      <Skeleton className="mt-8 aspect-video w-full rounded-2xl" />
      <div className="mt-6 space-y-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}

function ErrorView({ url, onRetry }: { url?: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="font-serif text-3xl">Couldn’t load this issue.</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
        {url && (
          <Button variant="ghost" onClick={() => window.open(url, "_blank", "noopener")}>
            Open original <ArrowUpRight />
          </Button>
        )}
      </div>
    </div>
  )
}

const SHORTCUTS: [string[], string][] = [
  [["J", "→", "L"], "Next story"],
  [["K", "←", "H"], "Previous story"],
  [["Space"], "Scroll / next at end"],
  [["⇧", "Space"], "Scroll up / previous"],
  [["↓", "↑"], "Scroll story"],
  [["N", "]"], "Next issue"],
  [["P", "["], "Previous issue"],
  [["G"], "First story of issue"],
  [["⇧", "G"], "Latest issue"],
  [["O", "↵"], "Open original"],
  [["0", "1", "2"], "All / WhoJoshi / The Code"],
  [["T"], "Toggle theme"],
  [["?"], "Toggle this panel"],
]

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl border bg-card p-6 shadow-2xl"
      >
        <h2 className="font-serif text-3xl">Shortcuts</h2>
        <ul className="mt-4 space-y-2.5 text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{label}</span>
              <span className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </motion.div>
    </motion.div>
  )
}

"use client"
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/immutability */

import * as React from "react"
import { AnimatePresence, motion, MotionConfig, useMotionValue, useSpring, type PanInfo } from "motion/react"
import { ArrowRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Keyboard, Moon, PartyPopper, Sun, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useParams, useRouter } from "next/navigation"
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

// damping ≈ 2·√(stiffness·mass) → critically damped: smooth settle, no overshoot (~450ms)
const CARD_SPRING = { type: "spring", stiffness: 260, damping: 32, mass: 1 } as const

type ListState ={ issues: IssueMeta[]; page: number; done: boolean; loading: boolean }
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

/* ---------------- days (local time, "YYYY-MM-DD") ---------------- */

const pad = (n: number) => String(n).padStart(2, "0")
const dayKey = (d: string | Date) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}
const parseDay = (k: string) => new Date(`${k}T00:00:00`)
const shiftDay = (k: string, n: number) => {
  const d = parseDay(k)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}
/** "Today", "Yesterday", or "Mon, Nov 10" */
const fmtDay = (k: string) => {
  const today = dayKey(new Date())
  if (k === today) return "Today"
  if (k === shiftDay(today, -1)) return "Yesterday"
  const d = parseDay(k)
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })
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

/* ---------------- reader's name ---------------- */

const DEFAULT_NAME = "friend"

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Fill the server's {{name}} / {{NAME}} placeholders. Pass html=true for HTML strings. */
function fillName(s: string, name: string, html = false) {
  const n = html ? escapeHtml(name) : name
  return s.replace(/\{\{name\}\}/g, n).replace(/\{\{NAME\}\}/g, n.toUpperCase())
}

/* ---------------- reader ---------------- */

export function Reader() {
  const [lists, setLists] = React.useState<Record<SourceId, ListState>>({
    superhuman: { issues: [], page: 0, done: false, loading: false },
    code: { issues: [], page: 0, done: false, loading: false },
  })
  const [loaded, setLoaded] = React.useState<Record<string, Loaded>>({})
  const [filter, setFilter] = React.useState<Filter>("all")
  // `end` = showing the "all caught up" card after the day's last story
  const [cur, setCur] = React.useState<{ key: string | null; story: number; end?: boolean }>({ key: null, story: 0 })
  const [calOpen, setCalOpen] = React.useState(false)
  // "now" is read after mount — reading the clock during render breaks prerendering (cacheComponents)
  const [now, setNow] = React.useState<Date | null>(null)
  const [touch, setTouch] = React.useState(false) // coarse pointer (phones/tablets)
  const [swipeHint, setSwipeHint] = React.useState(false)
  const params = useParams<{ date?: string }>()
  const router = useRouter()
  const routeDay = params?.date ?? null
  const inflight = React.useRef(new Set<SourceId>())
  const [dir, setDir] = React.useState(1)
  const [help, setHelp] = React.useState(false)
  const [dark, setDark] = React.useState(false)
  const [name, setName] = React.useState("")
  const [askName, setAskName] = React.useState(false)
  const displayName = name || DEFAULT_NAME
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const listsRef = React.useRef(lists)
  listsRef.current = lists
  const loadedRef = React.useRef(loaded)
  loadedRef.current = loaded

  /* ---- boot ---- */
  React.useEffect(() => {
    setNow(new Date())
    const isTouch = window.matchMedia("(pointer: coarse)").matches
    setTouch(isTouch)
    if (isTouch && !store.get("swipeHintSeen")) setSwipeHint(true)
    setDark(document.documentElement.classList.contains("dark"))
    const saved = store.get("name")
    if (saved !== null) setName(saved)
    else setAskName(true) // first visit: ask for a name
    const f = store.get("filter") as Filter | null
    if (f && FILTERS.some((x) => x.id === f)) setFilter(f)
  }, [])

  /* ---- data loading ---- */
  const loadPage = React.useCallback(async (source: SourceId) => {
    const st = listsRef.current[source]
    if (st.done || inflight.current.has(source)) return
    inflight.current.add(source) // sync guard: effects can fire twice before state updates land
    const page = st.page + 1
    setLists((l) => ({ ...l, [source]: { ...l[source], loading: true } }))
    try {
      const res = await fetch(`/api/issues?source=${source}&page=${page}`, { cache: "no-store" })
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
    } finally {
      inflight.current.delete(source)
    }
  }, [])

  const loadIssue = React.useCallback(async (meta: IssueMeta) => {
    const k = keyOf(meta)
    const s = loadedRef.current[k]
    if (s && s !== "error") return
    setLoaded((m) => ({ ...m, [k]: "loading" }))
    try {
      const res = await fetch(`/api/issue?source=${meta.source}&slug=${meta.slug}`, { cache: "no-store" })
      if (!res.ok) throw new Error()
      const issue = (await res.json()) as Issue
      setLoaded((m) => ({ ...m, [k]: issue }))
      // warm the image cache for the first couple of stories
      issue.stories.slice(0, 3).forEach((s) => s.image && (new Image().src = s.image))
    } catch {
      setLoaded((m) => ({ ...m, [k]: "error" }))
    }
  }, [])

  /* ---- derived feed: every loaded issue, then just the selected day ---- */
  const sources = React.useMemo<SourceId[]>(() => (filter === "all" ? ["superhuman", "code"] : [filter]), [filter])

  const allFeed = React.useMemo(
    () => sources.flatMap((s) => lists[s].issues).sort((a, b) => +new Date(b.date) - +new Date(a.date)),
    [lists, sources],
  )
  const latestDay = allFeed[0] ? dayKey(allFeed[0].date) : null
  const day = routeDay ?? latestDay // "/" → latest day with issues

  // a day is fully loaded once each source's archive reaches past it (or runs out)
  const dayCovered =
    !!day &&
    sources.every((s) => {
      const st = lists[s]
      const last = st.issues[st.issues.length - 1]
      return st.done || (!!last && dayKey(last.date) < day)
    })

  // page through the archive until the selected day is covered
  React.useEffect(() => {
    sources.forEach((s) => {
      const st = lists[s]
      if (st.done) return
      const last = st.issues[st.issues.length - 1]
      if (!last || (day && dayKey(last.date) >= day)) loadPage(s)
    })
  }, [day, lists, sources, loadPage])

  const feed = React.useMemo(() => (day ? allFeed.filter((i) => dayKey(i.date) === day) : []), [allFeed, day])

  // neighbouring days that have issues (older one falls back to "the day before" while still loading)
  const allDone = sources.every((s) => lists[s].done)
  const olderDay = day ? (allFeed.find((i) => dayKey(i.date) < day) ? dayKey(allFeed.find((i) => dayKey(i.date) < day)!.date) : allDone ? null : shiftDay(day, -1)) : null
  const newerDay = day ? ([...allFeed].reverse().find((i) => dayKey(i.date) > day)?.date ?? null) : null
  const newerDayKey = newerDay ? dayKey(newerDay) : null
  const daysWithIssues = React.useMemo(() => [...new Set(allFeed.map((i) => dayKey(i.date)))].map(parseDay), [allFeed])

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
  }, [issueIdx, feed, loadIssue])

  // preload next story's image
  React.useEffect(() => {
    const nxt = issue?.stories[storyIdx + 1]
    if (nxt?.image) new Image().src = nxt.image
  }, [issue, storyIdx])

  const isEnd = !!cur.end && !!issue && issueIdx === feed.length - 1

  /* ---- navigation ---- */
  const goDay = React.useCallback(
    (k: string | null) => {
      if (!k || k === day) return
      setDir(day && k > day ? -1 : 1) // older days slide in like "next"
      setCur({ key: null, story: 0 })
      setCalOpen(false)
      router.push(k === latestDay ? "/" : `/${k}`)
    },
    [day, latestDay, router],
  )

  const next = React.useCallback(() => {
    if (isEnd) return goDay(olderDay) // "yes, show me the previous day"
    if (!meta) return
    setDir(1)
    if (issue && storyIdx < issue.stories.length - 1) return setCur({ key: curKey, story: storyIdx + 1 })
    const n = feed[issueIdx + 1]
    if (n) return setCur({ key: keyOf(n), story: 0 })
    if (issue) setCur({ key: curKey, story: storyIdx, end: true }) // finished the day
  }, [isEnd, goDay, olderDay, meta, issue, storyIdx, feed, issueIdx, curKey])

  const prev = React.useCallback(() => {
    if (!meta) return
    setDir(-1)
    if (isEnd) return setCur({ key: curKey, story: storyIdx })
    if (storyIdx > 0) return setCur({ key: curKey, story: storyIdx - 1 })
    const p = feed[issueIdx - 1]
    if (p) setCur({ key: keyOf(p), story: -1 })
  }, [meta, isEnd, storyIdx, feed, issueIdx, curKey])

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
  // 0 at the top of a story → 1 after ~56px of scroll; drives the top edge blur
  const topFade = useMotionValue(0)
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    progress.set(max > 4 ? el.scrollTop / max : 1)
    topFade.set(Math.min(el.scrollTop / 56, 1))
  }
  React.useEffect(() => {
    progress.jump(0)
    smoothProgress.jump(0)
    topFade.jump(0)
    requestAnimationFrame(onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey, storyIdx, !!issue])

  /* ---- keyboard ---- */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return
      if (askName) return // name prompt is open
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
        case "Enter":
          if (isEnd) goDay(olderDay)
          else if (meta) window.open(meta.url, "_blank", "noopener")
          break
        case "o":
          if (meta) window.open(meta.url, "_blank", "noopener")
          break
        case ",":
          goDay(olderDay)
          break
        case ".":
          goDay(newerDayKey)
          break
        case "c":
          setCalOpen((o) => !o)
          break
        case "0":
        case "1":
        case "2":
          changeFilter(FILTERS[Number(e.key)].id)
          break
        case "t":
          toggleTheme()
          break
        case "u":
          setAskName(true)
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
  }, [next, prev, jumpIssue, changeFilter, toggleTheme, feed, meta, curKey, askName, isEnd, goDay, olderDay, newerDayKey])

  const saveName = (n: string) => {
    const clean = n.trim().replace(/\s+/g, " ").slice(0, 40)
    setName(clean)
    store.set("name", clean)
    setAskName(false)
  }

  /* ---- swipe ---- */
  const onDragEnd = (_: unknown, info: PanInfo) => {
    // a short flick or a ~70px drag both count
    const swipe = info.offset.x + info.velocity.x * 0.15
    if (Math.abs(swipe) < 70) return
    if (swipe < 0) next()
    else prev()
    navigator.vibrate?.(8) // tiny haptic tick on Android
    dismissSwipeHint()
  }

  const dismissSwipeHint = React.useCallback(() => {
    setSwipeHint(false)
    store.set("swipeHintSeen", "1")
  }, [])

  // the hint goes away on its own after a few seconds, or as soon as the reader moves
  React.useEffect(() => {
    if (!swipeHint) return
    const id = setTimeout(dismissSwipeHint, 6000)
    return () => clearTimeout(id)
  }, [swipeHint, dismissSwipeHint])
  React.useEffect(() => {
    if (swipeHint && (storyIdx > 0 || issueIdx > 0)) dismissSwipeHint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyIdx, issueIdx])

  const total = issue?.stories.length ?? 0
  const emptyDay = dayCovered && feed.length === 0
  const animKey = `${day}:${curKey}:${isEnd ? "end" : issue ? storyIdx : emptyDay ? "empty" : "loading"}`
  const hasNext = isEnd ? !!olderDay : !!issue || !!feed[issueIdx + 1]
  const hasPrev = isEnd || storyIdx > 0 || issueIdx > 0

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
            dpr={1} // it's a soft gradient — full-res buys nothing and costs battery on phones
          />
        </div>

        {/* header */}
        {/* phones: two rows (logo + actions, then a full-width filter). sm+: one row. */}
        <header className="relative z-10 grid w-full max-w-3xl lg:max-w-[60rem] grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2.5 px-3.5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5 sm:flex sm:justify-between sm:px-6 sm:pt-4 sm:pb-3">
          <div className="flex items-baseline gap-1 select-none sm:order-1">
            <span className="font-serif text-2xl leading-none tracking-tight">brief</span>
            <span className="font-serif text-2xl leading-none text-muted-foreground italic">.</span>
          </div>

          <nav className="col-span-2 flex items-center rounded-full border bg-card/60 p-1 backdrop-blur sm:order-2 sm:col-span-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => changeFilter(f.id)}
                className={cn(
                  "relative flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors sm:flex-none sm:py-1 sm:text-[0.8rem]",
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

          <div className="row-start-1 flex items-center justify-self-end gap-0.5 sm:order-3 sm:gap-1">
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    className="h-9 gap-1.5 rounded-full px-3 sm:h-8 sm:px-2.5"
                    aria-label="Pick a date"
                  />
                }
              >
                <CalendarDays />
                <span className="text-xs">{day ? fmtDay(day) : "…"}</span>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={day ? parseDay(day) : undefined}
                  defaultMonth={day ? parseDay(day) : undefined}
                  onSelect={(d) => d && goDay(dayKey(d))}
                  disabled={now ? { after: now } : undefined}
                  modifiers={{ hasIssues: daysWithIssues }}
                  modifiersClassNames={{ hasIssues: "has-issues" }}
                />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" className="hidden sm:inline-flex">
              <Keyboard />
            </Button>
            <Button variant="ghost" size="icon" className="size-9 sm:size-8" onClick={() => setAskName(true)} aria-label="Change your name" title={`Reading as ${displayName}`}>
              <UserRound />
            </Button>
            <Button variant="ghost" size="icon" className="size-9 sm:size-8" onClick={toggleTheme} aria-label="Toggle theme">
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
        </header>

        {/* card stage */}
        <main className="relative z-10 flex w-full max-w-3xl lg:max-w-[60rem] min-h-0 flex-1 flex-col px-2.5 sm:px-6">
          {/* story segments */}
          <div className="mb-2.5 flex h-1 gap-1 px-1.5 sm:mb-3 sm:px-1">
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
                // Only transform + opacity are animated (GPU-composited). An animated filter blur
                // on top of the card's backdrop blur and the WebGL aurora dropped frames.
                // The outgoing card fades out quickly so the two cards never sit stacked;
                // the incoming one glides in on a critically-damped spring (no bounce).
                variants={{
                  enter: (d: number) => ({ x: d * (touch ? 80 : 64), opacity: 0, scale: 0.985 }),
                  center: {
                    x: 0,
                    opacity: 1,
                    scale: 1,
                    transition: {
                      x: CARD_SPRING,
                      scale: CARD_SPRING,
                      opacity: { duration: 0.32, ease: "easeOut", delay: 0.06 },
                    },
                  },
                  exit: (d: number) => ({
                    x: d * -(touch ? 80 : 64),
                    opacity: 0,
                    scale: 0.985,
                    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
                  }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={CARD_SPRING}
                style={{ willChange: "transform, opacity" }}
                drag="x"
                dragDirectionLock
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.35}
                onDragEnd={onDragEnd}
                className="absolute inset-0 flex flex-col overflow-hidden rounded-[26px] border border-foreground/10 bg-card/70 backdrop-blur-xl shadow-[0_1px_0_0_color-mix(in_oklch,var(--foreground)_4%,transparent),0_30px_80px_-40px_rgba(0,0,0,0.45)] sm:rounded-3xl sm:bg-card/60 sm:backdrop-blur-2xl"
              >
                {/* top edge: content dissolves under a progressive blur once scrolled */}
                <motion.div
                  aria-hidden
                  style={{ opacity: topFade }}
                  className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 sm:h-20"
                >
                  {(touch ? [6] : [2, 5, 10]).map((px, i, all) => (
                    <div
                      key={px}
                      className="absolute inset-0"
                      style={{
                        backdropFilter: `blur(${px}px)`,
                        WebkitBackdropFilter: `blur(${px}px)`,
                        // each stronger layer covers a shorter band from the top
                        maskImage: `linear-gradient(to bottom, #000 ${((all.length - 1 - i) / all.length) * 40}%, transparent ${100 - (i / all.length) * 60}%)`,
                        WebkitMaskImage: `linear-gradient(to bottom, #000 ${((all.length - 1 - i) / all.length) * 40}%, transparent ${100 - (i / all.length) * 60}%)`,
                      }}
                    />
                  ))}
                  <div className="absolute inset-0 bg-gradient-to-b from-card/80 via-card/30 to-transparent" />
                </motion.div>
                <div
                  ref={(el) => {
                    // during cross-fade the exiting card unmounts last — keep the newest one
                    if (el) scrollRef.current = el
                  }}
                  onScroll={(e) => e.currentTarget === scrollRef.current && onScroll()}
                  className="no-scrollbar h-full overflow-y-auto overscroll-contain"
                >
                  {isEnd && day ? (
                    <EndOfDay
                      day={day}
                      olderDay={olderDay}
                      name={displayName}
                      onYes={() => goDay(olderDay)}
                      onPick={() => setCalOpen(true)}
                    />
                  ) : meta && story && issue ? (
                    <StoryView meta={meta} story={story} index={storyIdx} total={total} name={displayName} />
                  ) : emptyDay && day ? (
                    <EmptyDay day={day} olderDay={olderDay} onOlder={() => goDay(olderDay)} onPick={() => setCalOpen(true)} />
                  ) : issueState === "error" ? (
                    <ErrorView url={meta?.url} onRetry={() => meta && loadIssue(meta)} />
                  ) : (
                    <LoadingView meta={meta} name={displayName} />
                  )}
                </div>
              </motion.article>
            </AnimatePresence>

            {/* one-time swipe hint on touch screens */}
            <AnimatePresence>
              {swipeHint && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ delay: 0.4 }}
                  className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center"
                >
                  <div className="flex items-center gap-2 rounded-full border bg-background/85 px-4 py-2 text-xs font-medium shadow-lg backdrop-blur">
                    <motion.span
                      animate={{ x: [0, -6, 0, 6, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                      className="flex items-center"
                    >
                      <ChevronLeft className="size-3.5" />
                      <ChevronRight className="size-3.5" />
                    </motion.span>
                    Swipe for the next story
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* footer */}
        <footer className="relative z-10 flex w-full max-w-3xl lg:max-w-[60rem] items-center justify-between gap-3 px-3.5 pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-3 sm:pb-4">
          <Button
            variant="outline"
            size="icon-lg"
            className="size-11 rounded-full bg-card/60 backdrop-blur sm:size-9"
            onClick={prev}
            disabled={!hasPrev}
            aria-label="Previous"
          >
            <ChevronLeft className="size-5 sm:size-4" />
          </Button>

          <div className="min-w-0 flex-1 text-center">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${curKey ?? "none"}:${isEnd}:${emptyDay}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                {/* line 1: where you are */}
                <div className="truncate text-[11px] font-medium tracking-wider text-muted-foreground uppercase tabular-nums">
                  {isEnd && day
                    ? `All caught up · ${fmtDay(day)}`
                    : emptyDay && day
                      ? `No issues · ${fmtDay(day)}`
                      : meta
                        ? `${day ? fmtDay(day) + " · " : ""}${total ? `${storyIdx + 1} / ${total}` : "…"}`
                        : "Loading…"}
                </div>
                {/* line 2: which issue */}
                {meta && !isEnd && !emptyDay && (
                  <div className="mt-0.5 truncate text-xs text-foreground/75">{fillName(meta.title, displayName)}</div>
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

          <Button size="icon-lg" className="size-11 rounded-full sm:size-9" onClick={next} disabled={!hasNext} aria-label="Next">
            <ChevronRight className="size-5 sm:size-4" />
          </Button>
        </footer>

        <AnimatePresence>{help && <HelpOverlay onClose={() => setHelp(false)} />}</AnimatePresence>
        <AnimatePresence>
          {askName && (
            <NamePrompt
              initial={name}
              canClose={store.get("name") !== null}
              onSave={saveName}
              onClose={() => setAskName(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}

/* ---------------- pieces ---------------- */

function StoryView({
  meta,
  story: raw,
  index,
  total,
  name,
}: {
  meta: IssueMeta
  story: Story
  index: number
  total: number
  name: string
}) {
  const story = {
    ...raw,
    title: fillName(raw.title, name),
    kicker: raw.kicker && fillName(raw.kicker, name),
    html: fillName(raw.html, name, true),
  }
  meta = { ...meta, subtitle: fillName(meta.subtitle, name) }
  const isIntro = index === 0
  return (
    <div className="mx-auto max-w-[44rem] lg:max-w-[52rem] px-5 pt-5 pb-20 sm:px-10 sm:pt-9 sm:pb-16">
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground sm:mb-5 sm:text-xs">
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
          "font-serif leading-[1.04] tracking-tight text-balance hyphens-auto break-words",
          isIntro ? "text-[2.35rem] sm:text-6xl" : "text-[1.9rem] sm:text-5xl",
        )}
      >
        {story.title}
      </motion.h1>
      {isIntro && meta.subtitle && (
        <p className="mt-3 text-base text-muted-foreground text-pretty sm:text-lg">{meta.subtitle}</p>
      )}

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 30 }}
        className="news-prose mt-5 sm:mt-7"
        dangerouslySetInnerHTML={{ __html: story.html }}
      />

      <div className="mt-12 hidden items-center sm:flex justify-center text-xs text-muted-foreground/60">
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

function LoadingView({ meta, name }: { meta: IssueMeta | null; name: string }) {
  return (
    <div className="mx-auto max-w-[44rem] lg:max-w-[52rem] px-5 pt-6 sm:px-10 sm:pt-9">
      <div className="mb-5 flex items-center gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-14" />
      </div>
      {meta ? (
        <h1 className="font-serif text-[2.6rem] leading-[1.05] tracking-tight text-balance text-foreground/40 sm:text-6xl">
          {fillName(meta.title, name)}
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
  [["U"], "Change your name"],
  [["C"], "Pick a date"],
  [[","], "Previous day"],
  [["."], "Next day"],
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

function NamePrompt({
  initial,
  canClose,
  onSave,
  onClose,
}: {
  initial: string
  canClose: boolean
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [value, setValue] = React.useState(initial)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // focus once mounted (the intro animation may still be covering the page — typing works anyway)
  React.useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-md sm:items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => canClose && onClose()}
    >
      <motion.form
        initial={{ opacity: 0, y: 48, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && canClose) onClose()
        }}
        onSubmit={(e) => {
          e.preventDefault()
          onSave(value)
        }}
        className="w-full rounded-t-3xl border border-b-0 bg-card p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-sm sm:rounded-3xl sm:border-b sm:p-7"
      >
        <h2 className="font-serif text-4xl leading-none tracking-wide uppercase">What’s your name?</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Every issue will greet you by name. You can change it any time with <Kbd>U</Kbd>.
        </p>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          autoComplete="given-name"
          className="mt-6 h-11 rounded-xl px-4 text-base"
        />
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => onSave("")} className="text-muted-foreground">
            Skip
          </Button>
          <Button type="submit" size="lg" className="rounded-xl px-4" disabled={!value.trim()}>
            Continue <ArrowRight />
          </Button>
        </div>
      </motion.form>
    </motion.div>
  )
}

/** "yesterday's" / "Mon, Nov 9's" — for the end-of-day question */
const dayPhrase = (k: string) => {
  const f = fmtDay(k)
  return f === "Today" || f === "Yesterday" ? f.toLowerCase() : f
}

function EndOfDay({
  day,
  olderDay,
  name,
  onYes,
  onPick,
}: {
  day: string
  olderDay: string | null
  name: string
  onYes: () => void
  onPick: () => void
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
      <motion.div
        initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.05 }}
        className="mb-6 flex size-16 items-center justify-center rounded-2xl border bg-foreground/5"
      >
        <PartyPopper className="size-7" />
      </motion.div>
      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="font-serif text-4xl leading-none tracking-wide uppercase sm:text-6xl"
      >
        You’re all caught up
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="mt-4 max-w-sm text-muted-foreground text-pretty"
      >
        That’s every story from {dayPhrase(day)}, {name}.
        {olderDay ? ` Want to check out ${dayPhrase(olderDay)}’s stories?` : " That’s the end of the archive."}
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22 }}
        className="mt-8 flex flex-wrap items-center justify-center gap-2"
      >
        {olderDay && (
          <Button size="lg" className="h-10 rounded-full px-5" onClick={onYes}>
            Yes, show {dayPhrase(olderDay)} <ArrowRight />
          </Button>
        )}
        <Button size="lg" variant="outline" className="h-10 rounded-full px-5" onClick={onPick}>
          <CalendarDays /> Pick a date
        </Button>
      </motion.div>
      {olderDay && (
        <p className="mt-5 hidden items-center gap-1.5 text-xs text-muted-foreground/60 sm:flex">
          Press <Kbd>J</Kbd> or <Kbd>↵</Kbd> to continue
        </p>
      )}
    </div>
  )
}

function EmptyDay({
  day,
  olderDay,
  onOlder,
  onPick,
}: {
  day: string
  olderDay: string | null
  onOlder: () => void
  onPick: () => void
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
      <h2 className="font-serif text-4xl leading-none tracking-wide uppercase sm:text-5xl">No issues on {fmtDay(day)}</h2>
      <p className="mt-4 max-w-sm text-muted-foreground">Nothing was published that day. Try another one.</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {olderDay && (
          <Button size="lg" className="h-10 rounded-full px-5" onClick={onOlder}>
            Go to {fmtDay(olderDay)} <ArrowRight />
          </Button>
        )}
        <Button size="lg" variant="outline" className="h-10 rounded-full px-5" onClick={onPick}>
          <CalendarDays /> Pick a date
        </Button>
      </div>
    </div>
  )
}

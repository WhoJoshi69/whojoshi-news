import { isSource, listIssues } from "@/lib/newsletter"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const source = searchParams.get("source")
  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  if (!isSource(source)) return Response.json({ error: "unknown source" }, { status: 400 })
  try {
    const issues = await listIssues(source, page)
    return Response.json({ issues }, { headers: { "cache-control": "no-store" } })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 })
  }
}

import { getIssue, isSource } from "@/lib/newsletter"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const source = searchParams.get("source")
  const slug = searchParams.get("slug") ?? ""
  if (!isSource(source) || !/^[a-z0-9-]+$/.test(slug))
    return Response.json({ error: "bad request" }, { status: 400 })
  try {
    const issue = await getIssue(source, slug)
    return Response.json(issue, { headers: { "cache-control": "no-store" } })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 })
  }
}

import { notFound } from "next/navigation"

// "/YYYY-MM-DD" — a specific day. Rendering happens in the (reader) layout; this only validates.
export default async function DayPage({ params }: PageProps<"/[date]">) {
  const { date } = await params
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(`${date}T00:00:00`))
  if (!ok) notFound()
  return null
}

'use server'

// 도서 일괄 등록: 엑셀에서 붙여넣은 [바코드, 제목, 저자, AR지수, AR포인트, 퀴즈번호, IL] 행을 한 번에 등록.
// 이미 있는 바코드는 새로 만들지 않고 AR 정보만 갱신(빈 값은 덮어쓰지 않음). 삭제된 도서는 복원.
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/app/actions/auth'

export type ImportBookRow = {
  barcode: string
  title: string
  author?: string
  ar_level?: string
  ar_points?: string
  ar_quiz_no?: string
  interest_level?: string
}

export type ImportResult = {
  inserted: number
  updated: number
  restored: number
  errors: { barcode: string; error: string }[]
}

function toNum(v: string | undefined, max: number): number | null {
  const s = (v ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null
}

function normalize(r: ImportBookRow) {
  const barcode = (r.barcode ?? '').trim()
  const title = (r.title ?? '').replace(/\s+/g, ' ').trim()
  if (!barcode || barcode.length > 50) return { error: '바코드가 비었거나 너무 깁니다.' }
  if (!title || title.length > 200) return { error: '제목이 비었거나 200자를 넘습니다.' }
  return {
    barcode,
    base: { title, author: (r.author ?? '').replace(/\s+/g, ' ').trim().slice(0, 100) },
    ar: {
      ar_level: toNum(r.ar_level, 20),
      ar_points: toNum(r.ar_points, 999),
      ar_quiz_no: (r.ar_quiz_no ?? '').trim().slice(0, 20) || null,
      interest_level: (r.interest_level ?? '').trim().slice(0, 10) || null,
    },
  }
}

// 한 번에 최대 200행 (클라이언트에서 나눠서 호출)
export async function importBooks(rows: ImportBookRow[]): Promise<ImportResult & { fatal?: string }> {
  const result: ImportResult = { inserted: 0, updated: 0, restored: 0, errors: [] }
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return { ...result, fatal: '권한이 없습니다.' }
  if (rows.length > 200) return { ...result, fatal: '한 번에 200행까지 처리할 수 있습니다.' }

  const items: NonNullable<Exclude<ReturnType<typeof normalize>, { error: string }>>[] = []
  for (const r of rows) {
    const n = normalize(r)
    if ('error' in n) result.errors.push({ barcode: r.barcode ?? '', error: n.error ?? '형식 오류' })
    else items.push(n)
  }
  if (items.length === 0) return result

  const { data: existing, error: selErr } = await supabaseAdmin
    .from('books')
    .select('id, barcode, is_deleted')
    .in('barcode', items.map((i) => i.barcode))
  if (selErr) return { ...result, fatal: `조회 실패: ${selErr.message}` }
  const byBarcode = new Map((existing ?? []).map((b) => [b.barcode, b]))

  // 새 도서: 한 번에 insert
  const fresh = items.filter((i) => !byBarcode.has(i.barcode))
  if (fresh.length > 0) {
    const { error } = await supabaseAdmin.from('books').insert(
      fresh.map((i) => ({
        barcode: i.barcode,
        ...i.base,
        ...i.ar,
        location_group: '',
        location_detail: '',
        created_by: user.id,
      }))
    )
    if (error) {
      // 묶음 실패 시 한 권씩 재시도해 어떤 행이 문제인지 표시
      for (const i of fresh) {
        const { error: e1 } = await supabaseAdmin.from('books').insert({
          barcode: i.barcode,
          ...i.base,
          ...i.ar,
          location_group: '',
          location_detail: '',
          created_by: user.id,
        })
        if (e1) result.errors.push({ barcode: i.barcode, error: e1.message })
        else result.inserted++
      }
    } else {
      result.inserted += fresh.length
    }
  }

  // 기존 도서: AR 정보만 갱신 (빈 값은 유지), 삭제된 도서는 복원
  for (const i of items) {
    const ex = byBarcode.get(i.barcode)
    if (!ex) continue
    const patch: Record<string, unknown> = Object.fromEntries(
      Object.entries(i.ar).filter(([, v]) => v !== null)
    )
    if (ex.is_deleted) Object.assign(patch, i.base, { is_deleted: false, is_available: true })
    if (Object.keys(patch).length === 0) continue
    const { error } = await supabaseAdmin.from('books').update(patch).eq('id', ex.id)
    if (error) result.errors.push({ barcode: i.barcode, error: error.message })
    else if (ex.is_deleted) result.restored++
    else result.updated++
  }

  return result
}

// 잉글리시버드 책장 구간 (학생 대여 리스트의 도서레벨 구간과 동일). AR지수가 없는 책은 '리더스' 칸.
export const AR_SHELVES: { name: string; max: number }[] = [
  { name: 'AR 0점대', max: 1.0 },
  { name: 'AR 1.1-1.5', max: 1.5 },
  { name: 'AR 1.6-1.9', max: 1.9 },
  { name: 'AR 2.0-2.4', max: 2.4 },
  { name: 'AR 2.5-2.9', max: 2.9 },
  { name: 'AR 3.0-3.4', max: 3.4 },
  { name: 'AR 3.5-3.9', max: 3.9 },
  { name: 'AR 4.0-4.9', max: 4.9 },
  { name: 'AR 5.0+', max: Infinity },
]
export const NO_AR_SHELF = '리더스'

export function arShelfName(level: number | null | undefined): string {
  if (level === null || level === undefined || Number.isNaN(level)) return NO_AR_SHELF
  return AR_SHELVES.find((s) => level <= s.max + 1e-9)!.name
}

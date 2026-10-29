'use server'

import { randomInt } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { phoneToEmail, pinToPassword } from '@/lib/validations/auth'
import { MEMBER_CARD_PREFIX, isMemberCardCode, normalizeScanInput } from '@/lib/member-card'
import { getCurrentUser } from './auth'
import type { ActionResult } from '@/types'

async function requireApprovedAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin' || user.admin_status !== 'approved') return null
  return user
}

function generateCardCode(): string {
  return MEMBER_CARD_PREFIX + String(randomInt(0, 10_000_000_000)).padStart(10, '0')
}

// 코드 중복 시(확률 극히 낮음) 재시도하며 Auth 유저 생성
async function createAuthUserWithNewCode(): Promise<{ id: string; code: string } | { error: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCardCode()
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: phoneToEmail(code),
      password: pinToPassword(code),
      email_confirm: true,
    })
    if (!error && data.user) return { id: data.user.id, code }
    if (error && !error.message.includes('already')) return { error: error.message }
  }
  return { error: '회원카드 코드 생성에 실패했습니다.' }
}

export type CardMemberInput = {
  name: string
  group: string
  contact_phone?: string
  memo?: string
  book_level?: string
  book_count?: string | number
}

// 도서레벨(자유 입력, 40자)·권수(1~20, 비우면 null) 정리
function parseReading(level: string | undefined, count: string | number | undefined) {
  const book_level = (level ?? '').trim() || null
  const raw = String(count ?? '').replace(/[^\d]/g, '')
  const book_count = raw ? Number(raw) : null
  if (book_level && book_level.length > 40) return { error: '도서레벨은 40자 이내여야 합니다.' }
  if (book_count !== null && (book_count < 1 || book_count > 20)) return { error: '권수는 1~20 사이여야 합니다.' }
  return { values: { book_level, book_count } }
}

// 입력 정리·검증: 이름/반 필수, 연락처(숫자만)·메모는 선택
function parseMemberInput(input: CardMemberInput) {
  const name = input.name.trim()
  const group = input.group.trim()
  const contact_phone = (input.contact_phone ?? '').replace(/\D/g, '') || null
  const memo = (input.memo ?? '').trim() || null
  if (!name || name.length > 20) return { error: '이름은 1~20자로 입력해주세요.' }
  if (!group || group.length > 20) return { error: '반은 1~20자로 입력해주세요.' }
  if (contact_phone && contact_phone.length > 20) return { error: '휴대폰 번호가 너무 깁니다.' }
  if (memo && memo.length > 500) return { error: '메모는 500자 이내여야 합니다.' }
  const reading = parseReading(input.book_level, input.book_count)
  if ('error' in reading) return { error: reading.error }
  return { values: { name, dong_ho: group, contact_phone, memo, ...reading.values } }
}

// 관리자: 카드 회원 생성 (QR 코드 자동 발급)
export async function createCardMember(input: CardMemberInput): Promise<ActionResult<{ id: string }>> {
  if (!(await requireApprovedAdmin())) return { success: false, error: '권한이 없습니다.' }

  const parsed = parseMemberInput(input)
  if ('error' in parsed) return { success: false, error: parsed.error }

  const auth = await createAuthUserWithNewCode()
  if ('error' in auth) return { success: false, error: auth.error }

  const { error } = await supabaseAdmin
    .from('profiles')
    .insert({ id: auth.id, phone_number: auth.code, ...parsed.values })
  if (error) {
    await supabaseAdmin.auth.admin.deleteUser(auth.id)
    return { success: false, error: `회원 생성 실패: ${error.message}` }
  }

  return { success: true, data: { id: auth.id } }
}

// 관리자: 카드 회원 목록 (카드 인쇄용)
export async function getCardMembers() {
  if (!(await requireApprovedAdmin())) return []

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, name, dong_ho, phone_number, book_level, book_count, created_at')
    .eq('role', 'resident')
    .like('phone_number', `${MEMBER_CARD_PREFIX}%`)
    .order('dong_ho', { ascending: true })
    .order('name', { ascending: true })

  return (data ?? []).filter((p) => isMemberCardCode(p.phone_number))
}

// 관리자: 도서레벨·권수만 수정 (일괄 등록에서 기존 회원 갱신용 — 연락처·메모는 건드리지 않음)
export async function setCardMemberReading(
  userId: string,
  level: string | undefined,
  count: string | number | undefined
): Promise<ActionResult> {
  if (!(await requireApprovedAdmin())) return { success: false, error: '권한이 없습니다.' }

  const reading = parseReading(level, count)
  if ('error' in reading) return { success: false, error: reading.error }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(reading.values)
    .eq('id', userId)
    .eq('role', 'resident')
    .like('phone_number', `${MEMBER_CARD_PREFIX}%`)

  if (error) return { success: false, error: '저장에 실패했습니다.' }
  return { success: true }
}

// 관리자: 카드 회원 정보 수정 (이름/반/연락처/메모)
export async function updateCardMemberInfo(userId: string, input: CardMemberInput): Promise<ActionResult> {
  if (!(await requireApprovedAdmin())) return { success: false, error: '권한이 없습니다.' }

  const parsed = parseMemberInput(input)
  if ('error' in parsed) return { success: false, error: parsed.error }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(parsed.values)
    .eq('id', userId)
    .eq('role', 'resident')
    .like('phone_number', `${MEMBER_CARD_PREFIX}%`)

  if (error) return { success: false, error: '저장에 실패했습니다.' }
  return { success: true }
}

// 관리자: 카드 재발급 — 새 코드로 교체, 기존 카드는 무효
export async function reissueMemberCard(userId: string): Promise<ActionResult<{ code: string }>> {
  if (!(await requireApprovedAdmin())) return { success: false, error: '권한이 없습니다.' }

  const { data: target } = await supabaseAdmin
    .from('profiles')
    .select('id, role, phone_number')
    .eq('id', userId)
    .single()

  if (!target || target.role !== 'resident' || !isMemberCardCode(target.phone_number)) {
    return { success: false, error: '카드 회원이 아닙니다.' }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCardCode()
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: phoneToEmail(code),
      password: pinToPassword(code),
      email_confirm: true,
    })
    if (error) {
      if (error.message.includes('already')) continue
      return { success: false, error: '재발급에 실패했습니다.' }
    }
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ phone_number: code })
      .eq('id', userId)
    if (profileError) return { success: false, error: '재발급에 실패했습니다.' }
    return { success: true, data: { code } }
  }
  return { success: false, error: '재발급에 실패했습니다.' }
}

// 회원카드 QR로 로그인 (리더기/카메라 입력)
export async function signInByCard(rawCode: string): Promise<ActionResult<{ name: string }>> {
  const code = normalizeScanInput(rawCode)
  if (!isMemberCardCode(code)) {
    return { success: false, error: '회원카드가 아닙니다.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: phoneToEmail(code),
    password: pinToPassword(code),
  })
  if (error || !data.user) {
    return { success: false, error: '등록되지 않은 회원카드입니다.' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', data.user.id)
    .single()

  return { success: true, data: { name: profile?.name ?? '' } }
}

// 키오스크(리더기 모드)가 켜져 있을 때만 이름 로그인 허용
async function kioskEnabled() {
  const { data } = await supabaseAdmin.from('library_settings').select('value').eq('key', 'kiosk_mode').maybeSingle()
  return data?.value === 'on'
}

// 키오스크: 이름으로 카드 회원 찾기 — 이름 전체가 정확히 같을 때만(띄어쓰기 무시), 반만 함께 돌려줌
export async function findKioskMembersByName(
  rawName: string
): Promise<ActionResult<{ id: string; name: string; group: string }[]>> {
  if (!(await kioskEnabled())) return { success: false, error: '이름 로그인을 사용할 수 없습니다.' }
  const name = rawName.replace(/\s+/g, '')
  if (name.length < 2 || name.length > 20) return { success: false, error: '이름을 정확히 입력해주세요.' }

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, name, dong_ho, phone_number')
    .eq('role', 'resident')
    .like('phone_number', `${MEMBER_CARD_PREFIX}%`)
    .ilike('name', `%${name.split('').join('%')}%`)
    .limit(30)

  const list = (data ?? [])
    .filter((p) => isMemberCardCode(p.phone_number) && p.name.replace(/\s+/g, '') === name)
    .map((p) => ({ id: p.id, name: p.name, group: p.dong_ho }))
  if (list.length === 0) return { success: false, error: '등록된 이름이 없어요. 선생님께 말씀해주세요.' }
  return { success: true, data: list }
}

// 키오스크: 이름 검색 결과에서 고른 회원으로 로그인 (서버에서 카드 코드로 로그인)
export async function signInByMemberId(userId: string): Promise<ActionResult<{ name: string }>> {
  if (!(await kioskEnabled())) return { success: false, error: '이름 로그인을 사용할 수 없습니다.' }
  const { data: p } = await supabaseAdmin
    .from('profiles')
    .select('name, role, phone_number')
    .eq('id', userId)
    .maybeSingle()
  if (!p || p.role !== 'resident' || !isMemberCardCode(p.phone_number)) {
    return { success: false, error: '회원을 찾을 수 없습니다.' }
  }
  return signInByCard(p.phone_number)
}

// 키오스크: 리다이렉트 없이 로그아웃 (다음 사람 대기 화면 유지)
export async function kioskSignOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
}

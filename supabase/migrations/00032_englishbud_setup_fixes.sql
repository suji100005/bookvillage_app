-- 잉글리시버드 설치 중 발견한 누락분 (새 DB 설치 시 필요)

-- 1) 옛 자동 프로필 트리거 제거: 지금 코드는 프로필을 직접 생성하므로,
--    남아 있으면 관리자/회원/카드/게스트 생성이 모두 "Database error creating new user"로 실패함
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 2) 신작 도서 수동 지정 칸 (대시보드 신작 목록에서 사용)
ALTER TABLE books ADD COLUMN IF NOT EXISTS featured_until date;

-- 3) 도서 삭제내역: 관리자만 조회
ALTER TABLE book_deletions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "book_deletions_admin_select" ON book_deletions;
CREATE POLICY "book_deletions_admin_select" ON book_deletions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- 4) 연체 뷰: 이름·연락처가 담겨 있으므로 조회자 권한(RLS)을 따르게 하고 비로그인 접근 차단
ALTER VIEW overdue_rentals SET (security_invoker = true);
REVOKE ALL ON overdue_rentals FROM anon;

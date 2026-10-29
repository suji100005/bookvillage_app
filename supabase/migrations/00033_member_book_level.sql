-- 카드 회원별 대여 도서레벨·권수 (회원카드에 표시)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS book_level varchar(40);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS book_count smallint CHECK (book_count IS NULL OR book_count BETWEEN 1 AND 20);

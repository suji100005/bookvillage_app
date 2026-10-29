-- 영어 원서 AR 정보 (Renaissance Accelerated Reader)
ALTER TABLE books ADD COLUMN IF NOT EXISTS ar_level numeric(3,1);
ALTER TABLE books ADD COLUMN IF NOT EXISTS ar_points numeric(5,1);
ALTER TABLE books ADD COLUMN IF NOT EXISTS ar_quiz_no varchar(20);
ALTER TABLE books ADD COLUMN IF NOT EXISTS interest_level varchar(10);
CREATE INDEX IF NOT EXISTS idx_books_ar_level ON books(ar_level) WHERE is_deleted = false;

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScanBarcode, BookOpen, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMyNotificationCount } from "@/app/actions/rentals";
import { getUnreadNoticeCount } from "@/app/actions/notices";

export function BottomNav() {
  const pathname = usePathname();
  const isRentActive = pathname.startsWith("/rent");
  const isBooksActive = pathname.startsWith("/books");
  const isMypageActive = pathname.startsWith("/mypage");
  const [notifCount, setNotifCount] = useState(0);
  const [noticeCount, setNoticeCount] = useState(0);

  useEffect(() => {
    getMyNotificationCount().then(setNotifCount).catch(() => {});
    getUnreadNoticeCount().then(setNoticeCount).catch(() => {});
  }, [pathname]);

  const totalBadge = notifCount + noticeCount;

  return (
    <nav className="shrink-0 border-t bg-card relative">
      <ul className="flex items-end">
        {/* 도서 */}
        <li className="flex-1">
          <Link
            href="/books"
            className={cn(
              "flex flex-col items-center gap-[0.3vh] py-[1.5vh] transition-colors",
              isBooksActive
                ? "text-primary font-semibold"
                : "text-muted-foreground"
            )}
          >
            <BookOpen className="size-[clamp(1.4rem,3.2vw,2.2rem)]" />
            <span className="text-[clamp(0.8rem,1.8vw,1.1rem)]">도서</span>
          </Link>
        </li>

        {/* 대여하기 - 가운데 동그란 버튼 */}
        <li className="flex-1 flex justify-center">
          <Link
            href="/rent"
            className="flex flex-col items-center -mt-[clamp(2rem,5vw,3.5rem)] relative"
          >
            <div
              className={cn(
                "size-[clamp(4rem,9vw,5.5rem)] rounded-[1.6rem] flex items-center justify-center transition-transform border-4 border-card",
                isRentActive
                  ? "bg-primary text-primary-foreground scale-105"
                  : "bg-primary/90 text-primary-foreground"
              )}
            >
              <ScanBarcode className="size-[clamp(1.6rem,4vw,2.6rem)]" />
            </div>
            <span
              className={cn(
                "text-[clamp(0.8rem,1.8vw,1.1rem)] mt-[0.5vh] transition-colors",
                isRentActive
                  ? "text-primary font-semibold"
                  : "text-muted-foreground"
              )}
            >
              대여하기
            </span>
          </Link>
        </li>

        {/* 내 서재 */}
        <li className="flex-1">
          <Link
            href="/mypage"
            className={cn(
              "flex flex-col items-center gap-[0.3vh] py-[1.5vh] transition-colors relative",
              isMypageActive
                ? "text-primary font-semibold"
                : "text-muted-foreground"
            )}
          >
            <div className="relative">
              <User className="size-[clamp(1.4rem,3.2vw,2.2rem)]" />
              {totalBadge > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[1.1rem] h-[1.1rem] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[0.6rem] font-bold px-1">
                  {totalBadge > 9 ? "9+" : totalBadge}
                </span>
              )}
            </div>
            <span className="text-[clamp(0.8rem,1.8vw,1.1rem)]">내 서재</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  QrCode,
  ScanBarcode,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Loader2,
  LogOut,
  ArrowLeft,
  BookUp,
  BookDown,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManualScanInput } from "@/components/manual-scan-input";
import { useScannerInput } from "@/hooks/use-scanner-input";
import { isMemberCardCode, normalizeScanInput } from "@/lib/member-card";
import { signInByCard, signInByMemberId, findKioskMembersByName, kioskSignOut } from "@/app/actions/member-cards";
import { getCurrentUser } from "@/app/actions/auth";
import { selfCheckout, kioskReturn, getMyActiveRentals } from "@/app/actions/rentals";

type Rented = { barcode: string; title: string; due_date: string };
type Returned = { title: string; borrower?: string; overdue?: boolean; notRented?: boolean };
type Candidate = { id: string; name: string; group: string };
type Message = { type: "success" | "error"; text: string } | null;
type Phase = "loading" | "home" | "login" | "member" | "return" | "bye";

const BYE_MS = 5000;

function kstToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
function formatDue(date: string) {
  return new Date(date).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" });
}

// 홈 화면 리더기 모드(학원 데스크):
// [대출] 회원카드 QR 또는 이름 입력 → 책 바코드 찍기 (아래에 아직 반납 안 한 책 전체 표시)
// [반납] 책 바코드를 연속으로 찍기 (누구 책이 반납됐는지 표시)
// 일정 시간 입력이 없으면 처음 화면으로 돌아감
export function KioskPanel({
  logoutSec,
  allowReturn,
  scannerEnabled,
  onSignedOut,
}: {
  logoutSec: number;
  /** 유치원(학원) 모드: 키오스크 반납 허용 */
  allowReturn: boolean;
  /** 도서 정보/검색 등 오버레이가 열려 있으면 리더기 입력을 받지 않음 */
  scannerEnabled: boolean;
  /** 자동 로그아웃 시 대여 화면 상태 초기화 */
  onSignedOut: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [memberName, setMemberName] = useState("");
  const [rentals, setRentals] = useState<Rented[]>([]);
  const [justBorrowed, setJustBorrowed] = useState<string[]>([]);
  const [returned, setReturned] = useState<Returned[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(logoutSec);
  const [nameQuery, setNameQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const busyRef = useRef(false);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const byeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function showMessage(msg: Message, ms = 3500) {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage(msg);
    if (msg) messageTimer.current = setTimeout(() => setMessage(null), ms);
  }

  const goHome = useCallback(() => {
    setPhase("home");
    setMemberName("");
    setRentals([]);
    setJustBorrowed([]);
    setReturned([]);
    setNameQuery("");
    setCandidates([]);
    setMessage(null);
  }, []);

  async function enterMember(name: string) {
    if (byeTimer.current) clearTimeout(byeTimer.current);
    setMemberName(name);
    setJustBorrowed([]);
    setCandidates([]);
    setNameQuery("");
    setRemaining(logoutSec);
    setPhase("member");
    showMessage(null);
    setRentals(await getMyActiveRentals());
  }

  // 도서 목록 등 다른 화면에서 돌아온 경우 로그인 상태 이어가기
  useEffect(() => {
    getCurrentUser().then(async (u) => {
      if (u && u.role === "resident") {
        setMemberName(u.name);
        setPhase("member");
        setRentals(await getMyActiveRentals());
        return;
      }
      setPhase("home");
    });
  }, []);

  const finish = useCallback(async () => {
    const borrowedCount = justBorrowed.length;
    await kioskSignOut();
    onSignedOut();
    if (byeTimer.current) clearTimeout(byeTimer.current);
    setMessage(null);
    if (borrowedCount === 0) {
      goHome();
      return;
    }
    setPhase("bye");
    byeTimer.current = setTimeout(goHome, BYE_MS);
  }, [justBorrowed.length, onSignedOut, goHome]);

  // 자동 종료 카운트다운 (대출 로그인 / 대출 / 반납 화면)
  useEffect(() => {
    if (phase !== "member" && phase !== "login" && phase !== "return") return;
    if (remaining <= 0) {
      if (phase === "member") finish();
      else goHome();
      return;
    }
    const t = setTimeout(() => setRemaining((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, remaining, finish, goHome]);

  // 화면 터치·입력 시 시간 연장
  useEffect(() => {
    if (phase !== "member" && phase !== "login" && phase !== "return") return;
    const reset = () => setRemaining(logoutSec);
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [phase, logoutSec]);

  async function run(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function loginWithCard(code: string) {
    const result = await signInByCard(code);
    if (!result.success) {
      showMessage({ type: "error", text: result.error ?? "로그인에 실패했습니다." });
      return;
    }
    await enterMember(result.data?.name ?? "");
  }

  async function doReturn(code: string) {
    const ret = await kioskReturn(code);
    if (!ret.success || !ret.data) {
      showMessage({ type: "error", text: ret.error ?? "반납에 실패했습니다." });
      return;
    }
    const d = ret.data;
    if (d.status === "not_rented") {
      setReturned((prev) => [{ title: d.book_title, notRented: true }, ...prev]);
      showMessage({ type: "error", text: `「${d.book_title}」은(는) 대출 중인 책이 아니에요` });
      return;
    }
    setReturned((prev) => [{ title: d.book_title, borrower: d.borrower_name, overdue: d.overdue }, ...prev]);
    showMessage({ type: "success", text: `「${d.book_title}」 반납 완료!` });
  }

  async function doCheckout(code: string) {
    if (rentals.some((r) => r.barcode === code)) {
      showMessage({ type: "success", text: "이미 빌린 책이에요" });
      return;
    }
    const result = await selfCheckout(code);
    if (result.success && result.data) {
      setJustBorrowed((prev) => [...prev, code]);
      setRentals(await getMyActiveRentals());
      showMessage({ type: "success", text: `「${result.data.book_title}」 대출 완료!` });
    } else {
      showMessage({ type: "error", text: result.error ?? "대출에 실패했습니다." });
    }
  }

  // 리더기 입력: 화면마다 다르게 처리
  function handleScan(raw: string) {
    const code = normalizeScanInput(raw);
    if (!code) return;
    const p = phaseRef.current;
    run(async () => {
      if (isMemberCardCode(code)) {
        // 처음·로그인·대출 화면에서 카드가 찍히면 그 회원으로 대출 시작 (반납 화면에서는 안내)
        if (p === "return") {
          showMessage({ type: "error", text: "반납은 책 바코드만 찍으면 돼요" });
          return;
        }
        await loginWithCard(code);
        return;
      }
      if (p === "return") {
        setRemaining(logoutSec);
        await doReturn(code);
      } else if (p === "member") {
        setRemaining(logoutSec);
        await doCheckout(code);
      } else if (p === "home" && allowReturn) {
        // 처음 화면에서 책을 바로 찍으면 반납으로
        setReturned([]);
        setRemaining(logoutSec);
        setPhase("return");
        await doReturn(code);
      } else {
        showMessage({ type: "error", text: "먼저 회원카드를 찍거나 이름을 입력해주세요" });
      }
    });
  }

  useScannerInput(handleScan, scannerEnabled);

  // 이름 입력창: 리더기로 QR이 찍혀 들어오면 카드 로그인으로 처리
  function submitName() {
    const v = nameQuery.trim();
    if (!v) return;
    const asCode = normalizeScanInput(v);
    if (isMemberCardCode(asCode)) {
      setNameQuery("");
      run(() => loginWithCard(asCode));
      return;
    }
    run(async () => {
      const res = await findKioskMembersByName(v);
      if (!res.success || !res.data) {
        setCandidates([]);
        showMessage({ type: "error", text: res.error ?? "찾을 수 없어요" });
        return;
      }
      if (res.data.length === 1) {
        const r = await signInByMemberId(res.data[0].id);
        if (!r.success) {
          showMessage({ type: "error", text: r.error ?? "로그인에 실패했습니다." });
          return;
        }
        await enterMember(r.data?.name ?? res.data[0].name);
        return;
      }
      setCandidates(res.data);
    });
  }

  function pickCandidate(c: Candidate) {
    run(async () => {
      const r = await signInByMemberId(c.id);
      if (!r.success) {
        showMessage({ type: "error", text: r.error ?? "로그인에 실패했습니다." });
        return;
      }
      await enterMember(r.data?.name ?? c.name);
    });
  }

  const big = "text-[clamp(2rem,6vw,3.5rem)] font-bold leading-tight";
  const sub = "text-[clamp(1.1rem,3vw,1.6rem)] text-muted-foreground";
  const countdown = (
    <p className="text-[clamp(0.85rem,2vw,1.05rem)] text-muted-foreground/70 tabular-nums">
      {remaining}초 동안 입력이 없으면 처음 화면으로 돌아가요
    </p>
  );
  const backButton = (
    <Button variant="ghost" size="lg" className="absolute top-4 left-4 text-lg" onClick={goHome}>
      <ArrowLeft className="size-5 mr-1" />
      처음으로
    </Button>
  );

  const messageArea = (
    <div className="min-h-[clamp(3.5rem,8vh,5rem)] w-full max-w-2xl flex items-center justify-center">
      {busy ? (
        <Loader2 className="size-[clamp(2.5rem,6vw,3.5rem)] animate-spin text-primary" />
      ) : message ? (
        <div
          className={`w-full flex items-center justify-center gap-3 rounded-2xl px-6 py-4 text-[clamp(1.1rem,3vw,1.6rem)] font-bold ${
            message.type === "success" ? "bg-primary/15 text-primary" : "bg-destructive/10 text-destructive"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="size-[clamp(1.4rem,3.5vw,2rem)] shrink-0" />
          ) : (
            <AlertCircle className="size-[clamp(1.4rem,3.5vw,2rem)] shrink-0" />
          )}
          <span className="text-center">{message.text}</span>
        </div>
      ) : null}
    </div>
  );

  // 대출 화면 (로그인 후): 책 바코드 안내 + 아직 반납 안 한 책 전체
  if (phase === "member") {
    const today = kstToday();
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-[2vh] w-full max-w-2xl mx-auto">
        <div className="rounded-[1.5rem] bg-primary/10 p-[clamp(1rem,3.5vw,2rem)]">
          <ScanBarcode className="size-[clamp(4rem,14vw,7.5rem)] text-primary" />
        </div>
        <div className="text-center space-y-[0.8vh]">
          <p className="text-[clamp(1.1rem,3vw,1.6rem)] font-semibold text-muted-foreground">
            <span className="text-primary">{memberName}</span> 안녕하세요!
          </p>
          <p className="text-[clamp(1.8rem,5.5vw,3rem)] font-bold leading-tight">빌릴 책의 바코드를 찍어주세요</p>
          {countdown}
        </div>

        {messageArea}

        <Button
          size="lg"
          className="w-full h-[clamp(3.5rem,8vh,5rem)] text-[clamp(1.2rem,3.2vw,1.7rem)] font-bold rounded-2xl"
          onClick={() => run(finish)}
        >
          <LogOut className="size-[clamp(1.3rem,3.2vw,1.8rem)] mr-2" />
          다 빌렸어요
        </Button>

        <div className="w-full space-y-2">
          <p className="text-[clamp(1rem,2.4vw,1.25rem)] font-bold">
            빌리고 있는 책 <span className="text-primary">{rentals.length}권</span>
          </p>
          {rentals.length === 0 ? (
            <p className="rounded-2xl border border-dashed px-5 py-4 text-center text-muted-foreground">
              아직 반납하지 않은 책이 없어요
            </p>
          ) : (
            <ul className="space-y-2">
              {rentals.map((b) => {
                const overdue = b.due_date < today;
                const isNew = justBorrowed.includes(b.barcode);
                return (
                  <li
                    key={b.barcode}
                    className={`flex items-center gap-3 rounded-2xl border px-5 py-3 ${
                      overdue ? "border-destructive/50 bg-destructive/5" : isNew ? "border-primary/50 bg-primary/5" : "bg-muted/30"
                    }`}
                  >
                    <BookOpen className="size-[clamp(1.3rem,3vw,1.7rem)] text-primary shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-[clamp(1.05rem,2.6vw,1.4rem)] font-semibold">{b.title}</span>
                    {isNew && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">방금</span>}
                    <span
                      className={`shrink-0 text-[clamp(0.85rem,2vw,1.1rem)] ${overdue ? "font-bold text-destructive" : "text-muted-foreground"}`}
                    >
                      {overdue ? `연체 · ${formatDue(b.due_date)}까지였어요` : `${formatDue(b.due_date)}까지`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <ManualScanInput onSubmit={handleScan} placeholder="책 바코드 직접 입력" />
      </div>
    );
  }

  // 그 외 화면은 헤더·하단 메뉴 없이 전체 화면
  return (
    <div className="fixed inset-0 z-[140] bg-background flex flex-col items-center justify-center-safe gap-[3vh] px-6 py-16 h-dvh overflow-y-auto">
      {phase === "loading" && <Loader2 className="size-10 animate-spin text-muted-foreground" />}

      {phase === "home" && (
        <>
          <p className={big}>무엇을 할까요?</p>
          <div className={`grid w-full max-w-3xl gap-[2vw] ${allowReturn ? "grid-cols-2" : "grid-cols-1"}`}>
            <button
              onClick={() => {
                setRemaining(logoutSec);
                setPhase("login");
                showMessage(null);
              }}
              className="flex flex-col items-center justify-center gap-[2vh] rounded-[2rem] bg-primary py-[clamp(2.5rem,9vh,6rem)] text-primary-foreground shadow-md active:scale-[0.98] transition-transform"
            >
              <BookUp className="size-[clamp(4rem,12vw,7rem)]" />
              <span className="text-[clamp(2.2rem,6.5vw,4rem)] font-bold">대출</span>
              <span className="text-[clamp(1rem,2.4vw,1.3rem)] opacity-90">책 빌리기</span>
            </button>
            {allowReturn && (
              <button
                onClick={() => {
                  setReturned([]);
                  setRemaining(logoutSec);
                  setPhase("return");
                  showMessage(null);
                }}
                className="flex flex-col items-center justify-center gap-[2vh] rounded-[2rem] border-4 border-primary bg-background py-[clamp(2.5rem,9vh,6rem)] text-primary shadow-md active:scale-[0.98] transition-transform"
              >
                <BookDown className="size-[clamp(4rem,12vw,7rem)]" />
                <span className="text-[clamp(2.2rem,6.5vw,4rem)] font-bold">반납</span>
                <span className="text-[clamp(1rem,2.4vw,1.3rem)] opacity-90">책 돌려주기</span>
              </button>
            )}
          </div>
          {messageArea}
        </>
      )}

      {phase === "login" && (
        <>
          {backButton}
          <div className="rounded-[2rem] bg-primary/10 p-[clamp(1.2rem,4vw,2.5rem)]">
            <QrCode className="size-[clamp(5rem,16vw,9rem)] text-primary" />
          </div>
          <div className="text-center space-y-[1vh]">
            <p className={big}>회원카드를 찍어주세요</p>
            <p className={sub}>카드가 없으면 이름을 입력해도 돼요</p>
          </div>
          <div className="w-full max-w-md flex gap-2">
            <Input
              value={nameQuery}
              onChange={(e) => {
                setNameQuery(e.target.value);
                setCandidates([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) submitName();
              }}
              placeholder="이름 (예: 김하늘)"
              className="h-16 text-2xl md:text-2xl text-center"
            />
            <Button className="h-16 px-6 text-xl" onClick={submitName} disabled={!nameQuery.trim() || busy}>
              <Search className="size-6" />
            </Button>
          </div>
          {candidates.length > 0 && (
            <div className="w-full max-w-md space-y-2">
              <p className="text-center text-muted-foreground">같은 이름이 있어요. 내 반을 골라주세요</p>
              {candidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pickCandidate(c)}
                  className="w-full flex items-center justify-between rounded-2xl border-2 px-6 py-4 text-xl font-semibold hover:border-primary active:scale-[0.99]"
                >
                  <span>{c.name}</span>
                  <span className="text-primary">{c.group}</span>
                </button>
              ))}
            </div>
          )}
          {messageArea}
          {countdown}
        </>
      )}

      {phase === "return" && (
        <>
          {backButton}
          <div className="rounded-[2rem] bg-primary/10 p-[clamp(1.2rem,4vw,2.5rem)]">
            <ScanBarcode className="size-[clamp(5rem,16vw,9rem)] text-primary" />
          </div>
          <div className="text-center space-y-[1vh]">
            <p className={big}>반납할 책의 바코드를 찍어주세요</p>
            <p className={sub}>여러 권이면 한 권씩 차례로 찍으면 돼요</p>
          </div>
          {messageArea}
          {returned.length > 0 && (
            <ul className="w-full max-w-2xl space-y-2">
              {returned.map((r, i) => (
                <li
                  key={i}
                  className={`flex items-center gap-3 rounded-2xl border px-5 py-3 ${r.notRented ? "opacity-60" : "bg-primary/5 border-primary/30"}`}
                >
                  {r.notRented ? (
                    <AlertCircle className="size-6 text-muted-foreground shrink-0" />
                  ) : (
                    <CheckCircle2 className="size-6 text-primary shrink-0" />
                  )}
                  <span className="flex-1 min-w-0 truncate text-[clamp(1.05rem,2.6vw,1.4rem)] font-semibold">{r.title}</span>
                  <span className="shrink-0 text-[clamp(0.85rem,2vw,1.1rem)] text-muted-foreground">
                    {r.notRented ? "대출 중 아님" : `${r.borrower ?? ""} 반납${r.overdue ? " · 연체였어요" : ""}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button size="lg" className="w-full max-w-2xl h-[clamp(3.5rem,8vh,5rem)] text-[clamp(1.2rem,3.2vw,1.7rem)] font-bold rounded-2xl" onClick={goHome}>
            다 반납했어요
          </Button>
          {countdown}
          <ManualScanInput onSubmit={handleScan} placeholder="책 바코드 직접 입력" />
        </>
      )}

      {phase === "bye" && (
        <div className="flex flex-col items-center gap-[2vh] text-center">
          <CheckCircle2 className="size-[clamp(5rem,16vw,9rem)] text-primary" />
          <p className={big}>{justBorrowed.length}권 빌렸어요!</p>
          <p className="text-[clamp(1.2rem,3.2vw,1.8rem)] text-muted-foreground">반납일을 꼭 지켜주세요. 안녕히 가세요 👋</p>
        </div>
      )}

      <Link href="/admin/login" className="absolute bottom-3 right-4 text-xs text-muted-foreground/40 hover:text-muted-foreground">
        관리자
      </Link>
    </div>
  );
}

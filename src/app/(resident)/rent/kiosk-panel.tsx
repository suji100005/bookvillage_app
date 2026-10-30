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

// 홈 화면 리더기 모드(학원 데스크):
// [대출] 회원카드 QR 또는 이름 입력 → 책 바코드 찍기 (아래에 아직 반납 안 한 책 전체 표시)
// [반납] 책 바코드를 연속으로 찍기 (누구 책이 반납됐는지 표시)
// 일정 시간 입력이 없으면 처음 화면으로 돌아감
export function KioskPanel({
  logoutSec,
  allowReturn,
  scannerEnabled,
  onSignedOut,
  libraryName,
  logoUrl,
}: {
  /** 처음 화면 로고·도서관 이름 */
  libraryName?: string;
  logoUrl?: string;
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

  const countdown = (
    <p className="text-[clamp(0.85rem,1.8vw,1rem)] text-muted-foreground tabular-nums">
      {remaining}초 동안 아무것도 안 하면 처음 화면으로 돌아가요
    </p>
  );
  const backButton = (
    <button
      onClick={goHome}
      className="absolute top-5 left-5 flex items-center gap-1.5 rounded-full bg-card px-4 py-2.5 text-[clamp(1rem,2vw,1.15rem)] font-semibold text-foreground ring-1 ring-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-5" />
      처음으로
    </button>
  );

  const messageArea = (
    <div className="min-h-[clamp(3.5rem,8vh,5rem)] w-full max-w-2xl flex items-center justify-center" aria-live="polite">
      {busy ? (
        <Loader2 className="size-[clamp(2.5rem,6vw,3.5rem)] animate-spin text-primary" />
      ) : message ? (
        <div
          className={`w-full flex items-center gap-3 rounded-[1.25rem] px-6 py-4 text-[clamp(1.1rem,2.8vw,1.5rem)] font-bold ${
            message.type === "success" ? "bg-primary text-primary-foreground" : "bg-destructive/10 text-destructive ring-1 ring-destructive/30"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="size-[clamp(1.4rem,3.5vw,2rem)] shrink-0" />
          ) : (
            <AlertCircle className="size-[clamp(1.4rem,3.5vw,2rem)] shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      ) : null}
    </div>
  );

  // 대출 화면 (로그인 후): 책 바코드 안내 + 아직 반납 안 한 책 전체 (도서관 대출 카드처럼)
  if (phase === "member") {
    const today = kstToday();
    return (
      <div className="flex-1 flex flex-col gap-[2.2vh] w-full max-w-2xl mx-auto py-[1vh]">
        <div className="flex items-center gap-[clamp(1rem,3vw,1.6rem)] rounded-[1.75rem] bg-primary px-[clamp(1.25rem,4vw,2.25rem)] py-[clamp(1.25rem,3.5vh,2rem)] text-primary-foreground">
          <ScanBarcode className="size-[clamp(3.5rem,10vw,5.5rem)] shrink-0 opacity-90" strokeWidth={1.6} />
          <div className="min-w-0">
            <p className="text-[clamp(1.05rem,2.6vw,1.4rem)] opacity-85">{memberName} 안녕하세요!</p>
            <p className="text-[clamp(1.6rem,4.6vw,2.6rem)] font-bold leading-tight break-keep">빌릴 책의 바코드를 찍어주세요</p>
          </div>
        </div>

        {messageArea}

        <section className="rounded-[1.75rem] bg-card ring-1 ring-border overflow-hidden">
          <div className="flex items-baseline justify-between px-[clamp(1.1rem,3vw,1.75rem)] pt-5 pb-3 border-b border-dashed border-border">
            <h2 className="text-[clamp(1.15rem,2.6vw,1.45rem)] font-bold">빌리고 있는 책</h2>
            <span className="font-en text-[clamp(1.1rem,2.4vw,1.35rem)] font-semibold text-primary tabular-nums">{rentals.length}권</span>
          </div>
          {rentals.length === 0 ? (
            <p className="px-6 py-8 text-center text-[clamp(1rem,2.2vw,1.2rem)] text-muted-foreground">
              아직 반납하지 않은 책이 없어요. 첫 책을 찍어볼까요?
            </p>
          ) : (
            <ul className="divide-y divide-dashed divide-border">
              {rentals.map((b) => {
                const overdue = b.due_date < today;
                const isNew = justBorrowed.includes(b.barcode);
                return (
                  <li key={b.barcode} className="flex items-center gap-4 px-[clamp(1.1rem,3vw,1.75rem)] py-[clamp(0.8rem,2vh,1.1rem)]">
                    <span className={`h-12 w-2 shrink-0 rounded-full ${overdue ? "bg-destructive" : isNew ? "bg-[#9dc183]" : "bg-primary/25"}`} aria-hidden />
                    <div className="flex-1 min-w-0">
                      <p className="font-en truncate text-[clamp(1.05rem,2.5vw,1.35rem)] font-semibold leading-snug">{b.title}</p>
                      {isNew && <p className="text-sm font-semibold text-primary">방금 빌렸어요</p>}
                    </div>
                    <DueStamp date={b.due_date} overdue={overdue} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Button
          size="lg"
          className="w-full h-[clamp(3.5rem,8vh,5rem)] text-[clamp(1.2rem,3.2vw,1.6rem)] font-bold rounded-[1.25rem]"
          onClick={() => run(finish)}
        >
          <LogOut className="size-[clamp(1.3rem,3.2vw,1.8rem)] mr-2" />
          다 빌렸어요
        </Button>
        <div className="flex flex-col items-center gap-2">
          {countdown}
          <ManualScanInput onSubmit={handleScan} placeholder="책 바코드 직접 입력" />
        </div>
      </div>
    );
  }

  // 그 외 화면은 헤더·하단 메뉴 없이 전체 화면 (크림 종이 바탕)
  return (
    <div className="fixed inset-0 z-[140] bg-background flex flex-col items-center justify-center-safe gap-[3vh] px-6 py-20 h-dvh overflow-y-auto">
      {phase === "loading" && <Loader2 className="size-10 animate-spin text-muted-foreground" />}

      {phase === "home" && (
        <>
          <div className="absolute top-5 left-6 flex items-center gap-3">
            {logoUrl && <img src={logoUrl} alt="" className="size-12 rounded-xl object-contain bg-card ring-1 ring-border" />}
            <div className="leading-tight">
              <p className="font-en text-[clamp(1rem,2vw,1.2rem)] font-semibold text-primary">English Bud Library</p>
              {libraryName && <p className="text-sm text-muted-foreground">{libraryName}</p>}
            </div>
          </div>

          <h1 className="text-[clamp(2rem,5.5vw,3.25rem)] font-bold tracking-tight text-center">오늘은 무엇을 할까요?</h1>

          <div className={`grid w-full max-w-4xl gap-[clamp(0.8rem,2vw,1.4rem)] ${allowReturn ? "grid-cols-2" : "grid-cols-1"}`}>
            <button
              onClick={() => {
                setRemaining(logoutSec);
                setPhase("login");
                showMessage(null);
              }}
              className="group flex flex-col items-start justify-between gap-[5vh] rounded-[2rem] bg-primary p-[clamp(1.5rem,4vw,2.5rem)] text-left text-primary-foreground transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
            >
              <BookUp className="size-[clamp(3.5rem,9vw,5.5rem)]" strokeWidth={1.6} />
              <span className="flex flex-col gap-1">
                <span className="text-[clamp(2.6rem,7vw,4.5rem)] font-bold leading-none">대출</span>
                <span className="font-en text-[clamp(1.1rem,2.6vw,1.5rem)] font-medium opacity-75">Borrow</span>
                <span className="mt-2 text-[clamp(1rem,2.2vw,1.25rem)] opacity-90">카드 찍고 책 빌리기</span>
              </span>
            </button>
            {allowReturn && (
              <button
                onClick={() => {
                  setReturned([]);
                  setRemaining(logoutSec);
                  setPhase("return");
                  showMessage(null);
                }}
                className="group flex flex-col items-start justify-between gap-[5vh] rounded-[2rem] bg-accent p-[clamp(1.5rem,4vw,2.5rem)] text-left text-accent-foreground ring-1 ring-primary/15 transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
              >
                <BookDown className="size-[clamp(3.5rem,9vw,5.5rem)]" strokeWidth={1.6} />
                <span className="flex flex-col gap-1">
                  <span className="text-[clamp(2.6rem,7vw,4.5rem)] font-bold leading-none">반납</span>
                  <span className="font-en text-[clamp(1.1rem,2.6vw,1.5rem)] font-medium opacity-70">Return</span>
                  <span className="mt-2 text-[clamp(1rem,2.2vw,1.25rem)] opacity-90">책 바코드만 찍으면 끝</span>
                </span>
              </button>
            )}
          </div>
          <p className="text-[clamp(0.95rem,2vw,1.15rem)] text-muted-foreground">회원카드나 책을 바로 찍어도 돼요</p>
          {messageArea}
        </>
      )}

      {phase === "login" && (
        <>
          {backButton}
          <div className="flex flex-col items-center gap-[2.5vh] w-full max-w-lg">
            <div className="rounded-[1.75rem] bg-card p-[clamp(1rem,3vw,1.75rem)] ring-1 ring-border">
              <QrCode className="size-[clamp(4.5rem,13vw,7.5rem)] text-primary" strokeWidth={1.5} />
            </div>
            <div className="text-center space-y-1">
              <h1 className="text-[clamp(1.9rem,5vw,3rem)] font-bold tracking-tight">회원카드를 찍어주세요</h1>
              <p className="text-[clamp(1.05rem,2.6vw,1.4rem)] text-muted-foreground">카드가 없으면 이름을 입력해요</p>
            </div>
            <div className="w-full flex gap-2 rounded-[1.4rem] bg-card p-2 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
              <Input
                value={nameQuery}
                onChange={(e) => {
                  setNameQuery(e.target.value);
                  setCandidates([]);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) submitName();
                }}
                aria-label="이름"
                placeholder="이름 (예: 김하늘)"
                className="h-16 border-0 bg-transparent text-2xl md:text-2xl shadow-none focus-visible:ring-0"
              />
              <Button className="h-16 px-7 rounded-[1rem] text-xl" onClick={submitName} disabled={!nameQuery.trim() || busy}>
                <Search className="size-6 mr-1" />
                찾기
              </Button>
            </div>
            {candidates.length > 0 && (
              <div className="w-full space-y-2">
                <p className="text-center text-muted-foreground">같은 이름이 있어요. 내 반을 골라주세요</p>
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pickCandidate(c)}
                    className="w-full flex items-center justify-between rounded-[1.25rem] bg-card px-6 py-4 text-xl font-semibold ring-1 ring-border hover:ring-2 hover:ring-primary active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>{c.name}</span>
                    <span className="rounded-full bg-accent px-3 py-1 text-base text-accent-foreground">{c.group}</span>
                  </button>
                ))}
              </div>
            )}
            {messageArea}
            {countdown}
          </div>
        </>
      )}

      {phase === "return" && (
        <>
          {backButton}
          <div className="flex flex-col items-center gap-[2.5vh] w-full max-w-2xl">
            <div className="rounded-[1.75rem] bg-accent p-[clamp(1rem,3vw,1.75rem)]">
              <BookDown className="size-[clamp(4.5rem,13vw,7.5rem)] text-primary" strokeWidth={1.5} />
            </div>
            <div className="text-center space-y-1">
              <h1 className="text-[clamp(1.9rem,5vw,3rem)] font-bold tracking-tight">반납할 책을 찍어주세요</h1>
              <p className="text-[clamp(1.05rem,2.6vw,1.4rem)] text-muted-foreground">여러 권이면 한 권씩 차례로 찍어요</p>
            </div>
            {messageArea}
            {returned.length > 0 && (
              <section className="w-full rounded-[1.75rem] bg-card ring-1 ring-border overflow-hidden">
                <div className="flex items-baseline justify-between px-6 pt-5 pb-3 border-b border-dashed border-border">
                  <h2 className="text-[clamp(1.1rem,2.4vw,1.35rem)] font-bold">방금 반납한 책</h2>
                  <span className="font-en text-lg font-semibold text-primary tabular-nums">
                    {returned.filter((r) => !r.notRented).length}권
                  </span>
                </div>
                <ul className="divide-y divide-dashed divide-border">
                  {returned.map((r, i) => (
                    <li key={i} className={`flex items-center gap-4 px-6 py-3.5 ${r.notRented ? "opacity-60" : ""}`}>
                      {r.notRented ? (
                        <AlertCircle className="size-6 text-muted-foreground shrink-0" />
                      ) : (
                        <CheckCircle2 className="size-6 text-primary shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-en truncate text-[clamp(1.05rem,2.4vw,1.3rem)] font-semibold">{r.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {r.notRented ? "대출 중인 책이 아니에요" : `${r.borrower ?? ""} 학생이 빌린 책`}
                        </p>
                      </div>
                      {r.overdue && (
                        <span className="shrink-0 rounded-full bg-destructive/10 px-3 py-1 text-sm font-bold text-destructive">연체였어요</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <Button
              size="lg"
              className="w-full h-[clamp(3.5rem,8vh,5rem)] text-[clamp(1.2rem,3.2vw,1.6rem)] font-bold rounded-[1.25rem]"
              onClick={goHome}
            >
              다 반납했어요
            </Button>
            {countdown}
            <ManualScanInput onSubmit={handleScan} placeholder="책 바코드 직접 입력" />
          </div>
        </>
      )}

      {phase === "bye" && (
        <div className="flex flex-col items-center gap-[3vh] text-center">
          <p className="text-[clamp(2rem,5.5vw,3.25rem)] font-bold tracking-tight">{justBorrowed.length}권 빌렸어요!</p>
          {rentals[rentals.length - 1] && (
            <div className="kiosk-stamp-in">
              <DueStamp date={rentals.filter((r) => justBorrowed.includes(r.barcode)).map((r) => r.due_date).sort()[0] ?? rentals[0].due_date} large />
            </div>
          )}
          <p className="text-[clamp(1.15rem,3vw,1.6rem)] text-muted-foreground">이 날까지 꼭 돌려주세요. 즐겁게 읽어요!</p>
        </div>
      )}

      <Link href="/admin/login" className="absolute bottom-3 right-4 text-xs text-muted-foreground/50 hover:text-muted-foreground">
        관리자
      </Link>
    </div>
  );
}

// 도서관 반납일 도장: 대출 카드에 찍는 고무도장처럼 살짝 기울어진 잉크 테두리
function DueStamp({ date, overdue = false, large = false }: { date: string; overdue?: boolean; large?: boolean }) {
  const d = new Date(date);
  const md = d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).replace(/\.\s?/g, ".").replace(/\.$/, "");
  const wd = d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" });
  const color = overdue ? "text-destructive border-destructive" : "text-primary border-primary";
  return (
    <span
      className={`shrink-0 inline-flex flex-col items-center rounded-lg border-[2.5px] ${color} ${
        large ? "-rotate-6 px-8 py-4" : "-rotate-3 px-3 py-1"
      }`}
      style={{ boxShadow: "inset 0 0 0 2px var(--card)", outline: "1.5px solid currentColor", outlineOffset: "2px" }}
      aria-label={`${overdue ? "연체, 반납일 " : "반납일 "}${md} ${wd}`}
    >
      <span className={`font-semibold leading-none ${large ? "text-xl mb-1" : "text-[0.7rem]"}`}>{overdue ? "연체" : "반납일"}</span>
      <span className={`font-en font-bold leading-none tabular-nums ${large ? "text-[clamp(3.5rem,11vw,6rem)]" : "text-[clamp(1.15rem,2.5vw,1.4rem)]"}`}>
        {md}
      </span>
      <span className={`leading-none ${large ? "text-xl mt-1" : "text-[0.7rem] mt-0.5"}`}>({wd})</span>
    </span>
  );
}

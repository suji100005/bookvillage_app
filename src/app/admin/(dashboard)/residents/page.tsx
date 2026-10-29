"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Users, Loader2, Search, UserPlus, QrCode, Check, AlertCircle } from "lucide-react";
import { getAllResidents } from "@/app/actions/rentals";
import { isMemberCardCode } from "@/lib/member-card";
import { setCardMemberReading } from "@/app/actions/member-cards";

type Resident = Awaited<ReturnType<typeof getAllResidents>>[number];

function maskPhone(phone: string): string {
  if (phone.length === 11) {
    return phone.slice(0, 3) + "****" + phone.slice(7);
  }
  if (phone.length >= 7) {
    return phone.slice(0, 3) + "****" + phone.slice(-4);
  }
  return "***";
}

// 카드 회원은 phone_number가 카드 코드 → 보호자 연락처(선택)를 표시
function contactOf(r: Resident): string {
  if (isMemberCardCode(r.phone_number)) return r.contact_phone ? maskPhone(r.contact_phone) : "-";
  return maskPhone(r.phone_number);
}


// 회원 목록에서 바로 도서레벨·권수 수정 (Enter 또는 칸을 벗어나면 저장)
function ReadingEditor({
  member,
  onSaved,
  compact = false,
}: {
  member: Resident;
  onSaved: (level: string | null, count: number | null) => void;
  compact?: boolean;
}) {
  const [level, setLevel] = useState(member.book_level ?? "");
  const [count, setCount] = useState(member.book_count ? String(member.book_count) : "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const origLevel = member.book_level ?? "";
  const origCount = member.book_count ? String(member.book_count) : "";

  async function save() {
    if (level.trim() === origLevel && count.trim() === origCount) return;
    setState("saving");
    const result = await setCardMemberReading(member.id, level, count);
    if (!result.success) {
      setState("error");
      setError(result.error ?? "저장 실패");
      return;
    }
    const n = count.replace(/[^\d]/g, "");
    onSaved(level.trim() || null, n ? Number(n) : null);
    setState("saved");
    setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    if (e.key === "Escape") {
      setLevel(origLevel);
      setCount(origCount);
      setState("idle");
    }
  };

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Input
        aria-label={`${member.name} 도서레벨`}
        className={compact ? "h-9 w-32" : "h-8 w-36"}
        placeholder="도서레벨"
        value={level}
        maxLength={40}
        onChange={(e) => setLevel(e.target.value)}
        onBlur={save}
        onKeyDown={onKey}
      />
      <Input
        aria-label={`${member.name} 권수`}
        className={compact ? "h-9 w-14 text-center" : "h-8 w-14 text-center"}
        placeholder="권"
        inputMode="numeric"
        value={count}
        maxLength={2}
        onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={save}
        onKeyDown={onKey}
      />
      <span className="w-5 shrink-0" title={state === "error" ? error : undefined}>
        {state === "saving" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {state === "saved" && <Check className="size-4 text-green-600" />}
        {state === "error" && <AlertCircle className="size-4 text-destructive" />}
      </span>
    </div>
  );
}

export default function AdminResidentsPage() {
  const router = useRouter();
  const [residents, setResidents] = useState<Resident[]>([]);
  const [isLoading, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("전체");

  const groups = useMemo(
    () => ["전체", ...Array.from(new Set(residents.map((r) => r.dong_ho))).sort((a, b) => a.localeCompare(b, "ko"))],
    [residents]
  );

  function patchReading(id: string, book_level: string | null, book_count: number | null) {
    setResidents((prev) => prev.map((r) => (r.id === id ? { ...r, book_level, book_count } : r)));
  }

  useEffect(() => {
    startTransition(async () => {
      const data = await getAllResidents();
      setResidents(data);
    });
  }, []);

  const byGroup = group === "전체" ? residents : residents.filter((r) => r.dong_ho === group);
  const filtered = search.trim()
    ? byGroup.filter(
        (r) =>
          r.name.includes(search) ||
          r.dong_ho.includes(search) ||
          r.phone_number.includes(search) ||
          (r.contact_phone ?? "").includes(search)
      )
    : byGroup;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" />
            회원 목록
            <Badge variant="secondary" className="ml-1">{residents.length}명</Badge>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => router.push("/admin/residents/cards")}>
                <QrCode className="size-4 mr-1" />
                카드 인쇄
              </Button>
              <Button size="sm" variant="outline" onClick={() => router.push("/admin/residents/bulk")}>
                <Users className="size-4 mr-1" />
                일괄 등록
              </Button>
              <Button size="sm" onClick={() => router.push("/admin/residents/new")}>
                <UserPlus className="size-4 mr-1" />
                회원 추가
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 검색 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="이름, 소속, 연락처 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {groups.length > 2 && (
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <Button key={g} size="sm" variant={group === g ? "default" : "outline"} onClick={() => setGroup(g)}>
                  {g}
                </Button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            도서레벨·권수는 목록에서 바로 고치면 저장돼요 (Enter 또는 다른 칸 클릭). Esc를 누르면 취소돼요.
          </p>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {search ? "검색 결과가 없습니다." : "등록된 회원이 없습니다."}
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>이름</TableHead>
                      <TableHead>소속</TableHead>
                      <TableHead>도서레벨 · 권수</TableHead>
                      <TableHead>연락처</TableHead>
                      <TableHead className="text-right">가입일</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/admin/residents/${r.id}`)}
                      >
                        <TableCell className="font-medium">
                          {r.name}
                          {isMemberCardCode(r.phone_number) && (
                            <Badge variant="outline" className="ml-2 align-middle">QR</Badge>
                          )}
                        </TableCell>
                        <TableCell>{r.dong_ho}</TableCell>
                        <TableCell className="cursor-default" onClick={(e) => e.stopPropagation()}>
                          {isMemberCardCode(r.phone_number) ? (
                            <ReadingEditor
                              key={r.id}
                              member={r}
                              onSaved={(l, c) => patchReading(r.id, l, c)}
                            />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">
                          {contactOf(r)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {new Date(r.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className="border rounded-lg p-3 flex items-center justify-between cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/admin/residents/${r.id}`)}
                  >
                    <div>
                      <p className="font-medium">
                        {r.name}
                        {isMemberCardCode(r.phone_number) && (
                          <Badge variant="outline" className="ml-2 align-middle">QR</Badge>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {r.dong_ho} · {contactOf(r)}
                      </p>
                      {isMemberCardCode(r.phone_number) && (
                        <div className="mt-2">
                          <ReadingEditor
                            key={r.id}
                            member={r}
                            compact
                            onSaved={(l, c) => patchReading(r.id, l, c)}
                          />
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(r.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

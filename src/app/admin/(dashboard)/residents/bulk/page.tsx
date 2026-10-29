"use client";

// 회원 일괄 등록: 엑셀/구글시트에서 [이름, 반, 도서레벨, 권수, 보호자 연락처, 메모] 열을 복사해 붙여넣으면
// 한 줄씩 카드 회원(QR 카드 자동 발급)으로 등록한다.
// 이미 같은 이름+반 회원이 있으면 새로 만들지 않고 도서레벨·권수만 갱신한다(학기마다 레벨 갱신용).
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Users, CheckCircle2, AlertCircle, MinusCircle, RefreshCw } from "lucide-react";
import { createCardMember, getCardMembers, setCardMemberReading } from "@/app/actions/member-cards";

type Row = { name: string; group: string; book_level: string; book_count: string; contact_phone: string; memo: string };
type Status = { state: "wait" | "update" | "ok" | "updated" | "skip" | "error"; message?: string; id?: string };

const HEADER_WORDS = ["이름", "name", "성명"];

function parseRows(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
      return {
        name: cols[0] ?? "",
        group: cols[1] ?? "",
        book_level: cols[2] ?? "",
        book_count: cols[3] ?? "",
        contact_phone: cols[4] ?? "",
        memo: cols[5] ?? "",
      };
    })
    .filter((r) => !HEADER_WORDS.includes(r.name.toLowerCase()));
}

function validate(r: Row): string | null {
  if (!r.name || r.name.length > 20) return "이름은 1~20자";
  if (!r.group || r.group.length > 20) return "반은 1~20자";
  if (r.book_level.length > 40) return "도서레벨은 40자 이내";
  const n = r.book_count.replace(/[^\d]/g, "");
  if (r.book_count.trim() && (!n || Number(n) < 1 || Number(n) > 20)) return "권수는 1~20";
  return null;
}

const key = (name: string, group: string) => `${name.trim()}|${group.trim()}`;

export default function BulkCardMemberPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [existing, setExisting] = useState<Map<string, string>>(new Map());
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getCardMembers().then((list) => setExisting(new Map(list.map((m) => [key(m.name, m.dong_ho), m.id]))));
  }, []);

  const rows = useMemo(() => parseRows(text), [text]);

  // 미리보기 상태: 형식 오류 / 이미 등록됨 / 목록 안 중복
  const preview = useMemo(() => {
    const seen = new Set<string>();
    return rows.map((r): Status => {
      const err = validate(r);
      if (err) return { state: "error", message: err };
      const k = key(r.name, r.group);
      if (seen.has(k)) return { state: "skip", message: "목록 안 중복" };
      seen.add(k);
      const id = existing.get(k);
      if (id) {
        return r.book_level.trim() || r.book_count.trim()
          ? { state: "update", id }
          : { state: "skip", message: "이미 등록됨" };
      }
      return { state: "wait" };
    });
  }, [rows, existing]);

  const shown = statuses.length === rows.length ? statuses : preview;
  const toCreate = preview.filter((s) => s.state === "wait").length;
  const toUpdate = preview.filter((s) => s.state === "update").length;
  const okCount = shown.filter((s) => s.state === "ok").length;
  const updatedCount = shown.filter((s) => s.state === "updated").length;
  const total = toCreate + toUpdate;

  async function handleRun() {
    setRunning(true);
    const next = [...preview];
    setStatuses(next);
    for (let i = 0; i < rows.length; i++) {
      const cur = next[i];
      const r = rows[i];
      if (cur.state === "update" && cur.id) {
        const result = await setCardMemberReading(cur.id, r.book_level, r.book_count);
        next[i] = result.success ? { state: "updated" } : { state: "error", message: result.error ?? "실패" };
      } else if (cur.state === "wait") {
        const result = await createCardMember({
          name: r.name,
          group: r.group,
          book_level: r.book_level,
          book_count: r.book_count,
          contact_phone: r.contact_phone,
          memo: r.memo,
        });
        next[i] = result.success ? { state: "ok" } : { state: "error", message: result.error ?? "실패" };
      } else continue;
      setStatuses([...next]);
    }
    setRunning(false);
    setDone(true);
  }

  function reset() {
    setText("");
    setStatuses([]);
    setDone(false);
    getCardMembers().then((list) => setExisting(new Map(list.map((m) => [key(m.name, m.dong_ho), m.id]))));
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/admin/residents")}>
          <ArrowLeft className="size-4 mr-1" />
          회원 목록
        </Button>
        <h1 className="text-2xl font-bold">회원 일괄 등록</h1>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              엑셀·구글시트에서{" "}
              <b className="text-foreground">이름 | 반 | 도서레벨 | 권수 | 보호자 연락처 | 메모</b> 순서의 열을 그대로
              복사해 붙여넣으세요. 이름·반 외에는 비워도 됩니다.
            </p>
            <p>
              새 학생은 QR 회원카드가 자동 발급됩니다. 같은 이름+반이 이미 있으면 <b className="text-foreground">도서레벨·권수만
              갱신</b>해요(학기마다 레벨 바꿀 때 사용).
            </p>
          </div>
          <textarea
            className="w-full min-h-48 rounded-md border bg-transparent px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={"김하늘\t화요일\t1.1-1.5\t3\t01012345678\t메모\n이바다\t수요일\t2.0-2.4\t5"}
            value={text}
            disabled={running || done}
            onChange={(e) => {
              setText(e.target.value);
              setStatuses([]);
            }}
          />

          {rows.length > 0 && (
            <div className="rounded-md border max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="px-3 py-2 w-10">#</th>
                    <th className="px-3 py-2">이름</th>
                    <th className="px-3 py-2">반</th>
                    <th className="px-3 py-2">도서레벨</th>
                    <th className="px-3 py-2">권수</th>
                    <th className="px-3 py-2">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const s = shown[i];
                    return (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-1.5">{r.name}</td>
                        <td className="px-3 py-1.5">{r.group}</td>
                        <td className="px-3 py-1.5">{r.book_level || "-"}</td>
                        <td className="px-3 py-1.5">{r.book_count || "-"}</td>
                        <td className="px-3 py-1.5">
                          {s.state === "ok" && (
                            <span className="flex items-center gap-1 text-green-700">
                              <CheckCircle2 className="size-4" /> 등록됨
                            </span>
                          )}
                          {s.state === "updated" && (
                            <span className="flex items-center gap-1 text-green-700">
                              <RefreshCw className="size-4" /> 레벨 갱신됨
                            </span>
                          )}
                          {s.state === "update" && <span className="text-blue-700">기존 회원 · 레벨 갱신 예정</span>}
                          {s.state === "skip" && (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <MinusCircle className="size-4" /> {s.message}
                            </span>
                          )}
                          {s.state === "error" && (
                            <span className="flex items-center gap-1 text-destructive">
                              <AlertCircle className="size-4" /> {s.message}
                            </span>
                          )}
                          {s.state === "wait" && <span className="text-muted-foreground">대기</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Badge variant="secondary">{rows.length}줄</Badge>
            {!done && <Badge variant="outline">새로 등록 {toCreate}명</Badge>}
            {!done && toUpdate > 0 && <Badge variant="outline">레벨 갱신 {toUpdate}명</Badge>}
            {(running || done) && (
              <Badge>
                등록 {okCount}명{updatedCount > 0 ? ` · 갱신 ${updatedCount}명` : ""}
              </Badge>
            )}
          </div>

          {!done ? (
            <Button
              className="h-14 w-full text-lg font-semibold"
              onClick={handleRun}
              disabled={running || total === 0}
            >
              {running ? <Loader2 className="size-5 mr-1 animate-spin" /> : <Users className="size-5 mr-1" />}
              {running
                ? "처리 중… 창을 닫지 마세요"
                : toUpdate > 0 && toCreate === 0
                  ? `${toUpdate}명 도서레벨·권수 갱신`
                  : `${toCreate}명 등록 (QR 카드 발급)${toUpdate > 0 ? ` + ${toUpdate}명 갱신` : ""}`}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" className="h-12 flex-1" onClick={reset}>
                다른 명단 붙여넣기
              </Button>
              <Button className="h-12 flex-1" onClick={() => router.push("/admin/residents/cards")}>
                QR 카드 인쇄하러 가기
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

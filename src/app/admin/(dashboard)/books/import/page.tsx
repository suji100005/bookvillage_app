"use client";

// 도서 일괄 등록: 엑셀에서 [바코드 | 제목 | 저자 | AR지수 | AR포인트 | 퀴즈번호 | IL] 열을 복사해 붙여넣기.
// 200행씩 나눠 서버에 보내고 진행률을 표시한다. 이미 있는 바코드는 AR 정보만 갱신.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import { importBooks, type ImportBookRow } from "@/app/actions/book-import";

const CHUNK = 200;
const HEADER_WORDS = ["바코드", "바코드넘버", "barcode", "no"];

function parse(text: string): ImportBookRow[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const c = line.split("\t").map((v) => v.trim());
      return {
        barcode: c[0] ?? "",
        title: c[1] ?? "",
        author: c[2] ?? "",
        ar_level: c[3] ?? "",
        ar_points: c[4] ?? "",
        ar_quiz_no: c[5] ?? "",
        interest_level: c[6] ?? "",
      };
    })
    .filter((r) => !HEADER_WORDS.includes(r.barcode.toLowerCase()));
}

export default function BookImportPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<{ inserted: number; updated: number; restored: number } | null>(null);
  const [errors, setErrors] = useState<{ barcode: string; error: string }[]>([]);
  const [fatal, setFatal] = useState("");

  const rows = useMemo(() => parse(text), [text]);
  const dupInPaste = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    rows.forEach((r) => (seen.has(r.barcode) ? dup.add(r.barcode) : seen.add(r.barcode)));
    return [...dup];
  }, [rows]);
  const missingTitle = rows.filter((r) => !r.barcode || !r.title).length;
  const withAr = rows.filter((r) => r.ar_level).length;

  async function run() {
    setRunning(true);
    setFatal("");
    setErrors([]);
    setProgress(0);
    const total = { inserted: 0, updated: 0, restored: 0 };
    const errs: { barcode: string; error: string }[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const res = await importBooks(rows.slice(i, i + CHUNK));
      if (res.fatal) {
        setFatal(res.fatal);
        break;
      }
      total.inserted += res.inserted;
      total.updated += res.updated;
      total.restored += res.restored;
      errs.push(...res.errors);
      setProgress(Math.min(rows.length, i + CHUNK));
      setSummary({ ...total });
      setErrors([...errs]);
    }
    setRunning(false);
  }

  const done = !running && summary !== null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/admin/books")}>
          <ArrowLeft className="size-4 mr-1" />
          전체 도서
        </Button>
        <h1 className="text-2xl font-bold">도서 일괄 등록</h1>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              엑셀에서 <b className="text-foreground">바코드 | 제목 | 저자 | AR지수 | AR포인트 | 퀴즈번호 | IL</b> 순서의
              열을 그대로 복사해 붙여넣으세요. 바코드·제목 외에는 비워도 됩니다.
            </p>
            <p>
              이미 등록된 바코드는 새로 만들지 않고 <b className="text-foreground">AR 정보만 갱신</b>해요. 서가 위치는 등록 후
              &lsquo;책장 이동&rsquo;이나 목록에서 일괄 지정하세요.
            </p>
          </div>

          <textarea
            className="w-full min-h-56 rounded-md border bg-transparent px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={"600000\tAmazing Dolphins\tThomson, Sarah L.\t3.5\t0.5\t\t\n123456\tThe Pumpkin Patch\tMcnamara\t1.5\t0.5\t72345\tLG"}
            value={text}
            disabled={running}
            onChange={(e) => {
              setText(e.target.value);
              setSummary(null);
              setErrors([]);
              setFatal("");
            }}
          />

          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{rows.length}권</Badge>
              <Badge variant="outline">AR지수 있음 {withAr}권</Badge>
              {missingTitle > 0 && <Badge variant="destructive">바코드·제목 누락 {missingTitle}줄</Badge>}
              {dupInPaste.length > 0 && (
                <Badge variant="destructive">
                  같은 바코드 중복 {dupInPaste.length}개 ({dupInPaste.slice(0, 3).join(", ")}
                  {dupInPaste.length > 3 ? "…" : ""})
                </Badge>
              )}
            </div>
          )}

          {rows.length > 0 && !summary && (
            <div className="rounded-md border max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    {["바코드", "제목", "저자", "AR", "포인트", "퀴즈번호", "IL"].map((h) => (
                      <th key={h} className="px-2 py-1.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 30).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 font-mono">{r.barcode}</td>
                      <td className="px-2 py-1">{r.title}</td>
                      <td className="px-2 py-1 text-muted-foreground">{r.author}</td>
                      <td className="px-2 py-1">{r.ar_level}</td>
                      <td className="px-2 py-1">{r.ar_points}</td>
                      <td className="px-2 py-1">{r.ar_quiz_no}</td>
                      <td className="px-2 py-1">{r.interest_level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 30 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground border-t">… 외 {rows.length - 30}권</p>
              )}
            </div>
          )}

          {(running || summary) && (
            <div className="space-y-2">
              <div className="h-2 w-full rounded bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${rows.length ? (progress / rows.length) * 100 : 0}%` }}
                />
              </div>
              <p className="text-sm flex items-center gap-2">
                {done ? <CheckCircle2 className="size-4 text-green-600" /> : <Loader2 className="size-4 animate-spin" />}
                {progress} / {rows.length}권 처리
                {summary && (
                  <span className="text-muted-foreground">
                    · 새로 등록 {summary.inserted} · AR 갱신 {summary.updated}
                    {summary.restored ? ` · 복원 ${summary.restored}` : ""}
                    {errors.length ? ` · 실패 ${errors.length}` : ""}
                  </span>
                )}
              </p>
            </div>
          )}

          {fatal && (
            <p className="flex items-center gap-1.5 text-destructive text-sm">
              <AlertCircle className="size-4" /> {fatal}
            </p>
          )}

          {errors.length > 0 && (
            <div className="rounded-md border border-destructive/40 p-3 text-xs space-y-1 max-h-48 overflow-auto">
              <p className="font-semibold text-destructive">실패한 행 (바코드 · 사유)</p>
              {errors.map((e, i) => (
                <p key={i} className="font-mono">
                  {e.barcode || "(빈 바코드)"} · {e.error}
                </p>
              ))}
            </div>
          )}

          {!done ? (
            <Button
              className="h-14 w-full text-lg font-semibold"
              onClick={run}
              disabled={running || rows.length === 0 || dupInPaste.length > 0}
            >
              {running ? <Loader2 className="size-5 mr-1 animate-spin" /> : <Upload className="size-5 mr-1" />}
              {running ? "등록 중… 창을 닫지 마세요" : `${rows.length}권 등록`}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" className="h-12 flex-1" onClick={() => { setText(""); setSummary(null); setErrors([]); }}>
                다른 목록 붙여넣기
              </Button>
              <Button className="h-12 flex-1" onClick={() => router.push("/admin/books")}>
                전체 도서 보기
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

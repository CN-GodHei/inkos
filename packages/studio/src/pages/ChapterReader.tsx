import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { ChapterWorkspacePanel } from "../components/ChapterWorkspacePanel";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  List,
  BookOpenText,
  BookOpen,
  CheckCircle2,
  XCircle,
  Hash,
  Type,
  Clock,
  Pencil,
  Save,
  Eye,
  Copy,
} from "lucide-react";

interface ChapterData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

interface Nav {
  toBook: (id: string) => void;
  toBookSettings: (id: string) => void;
  toDashboard: () => void;
  toChapter: (bookId: string, num: number) => void;
}

// 去掉「第1章 / Chapter 3 / 12.」这类章节序号前缀，只保留真正的标题名。
function stripChapterNumberPrefix(input: string): string {
  const stripped = input
    .replace(/^\s*第\s*[0-9一二三四五六七八九十百千]+\s*章\s*/u, "")
    .replace(/^\s*(?:chapter|ch\.?|chap\.?)\s*\d+\s*[:：.\-]?\s*/i, "")
    .replace(/^\s*\d+\s*[:：.、\-]\s*/u, "");
  return stripped.trim();
}

export function ChapterReader({ bookId, chapterNumber, nav, theme, t }: {
  bookId: string;
  chapterNumber: number;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const { data, error, refetch } = useApi<ChapterData>(
    `/books/${bookId}/chapters/${chapterNumber}`,
  );
  const { data: bookData } = useApi<{ chapters: ReadonlyArray<{ number: number }> }>(
    `/books/${bookId}`,
  );
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [readingMode, setReadingMode] = useState(false);
  const [copied, setCopied] = useState<"title" | "body" | null>(null);
  const endSentinelRef = useRef<HTMLDivElement | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);

  // 章节序号（升序）与上一/下一章。
  const chapterNumbers = useMemo(
    () => (bookData?.chapters ?? []).map((ch) => ch.number).sort((a, b) => a - b),
    [bookData],
  );
  const currentIndex = chapterNumbers.indexOf(chapterNumber);
  const prevNumber = currentIndex > 0 ? chapterNumbers[currentIndex - 1] : undefined;
  const nextNumber =
    currentIndex >= 0 && currentIndex < chapterNumbers.length - 1
      ? chapterNumbers[currentIndex + 1]
      : undefined;
  const totalChapters = chapterNumbers.length;

  const goToChapter = (num: number | undefined) => {
    if (num === undefined) return;
    nav.toChapter(bookId, num);
  };

  // 章节切换时：清空编辑状态、回到页面顶部，避免自动续读误触发连跳。
  useEffect(() => {
    setEditing(false);
    setEditContent("");
    const scroller = document.querySelector("[data-scroll-container]");
    if (scroller) scroller.scrollTo({ top: 0 });
  }, [chapterNumber, bookId]);

  // data 一定带有所属章节号（后端返回 chapterNumber），据此判断数据是否对应当前章，
  // 避免章节切换瞬间用上一章的旧内容渲染。
  const isCurrent = data?.chapterNumber === chapterNumber;

  // 阅读模式：滚到本章末尾附近时自动续读下一章（退出视口可取消）。
  useEffect(() => {
    if (!readingMode || nextNumber === undefined || editing || !isCurrent) return;
    const sentinel = endSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          if (autoAdvanceTimerRef.current !== null) return;
          autoAdvanceTimerRef.current = window.setTimeout(() => {
            autoAdvanceTimerRef.current = null;
            nav.toChapter(bookId, nextNumber);
          }, 1200);
        } else if (autoAdvanceTimerRef.current !== null) {
          window.clearTimeout(autoAdvanceTimerRef.current);
          autoAdvanceTimerRef.current = null;
        }
      },
      { rootMargin: "0px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, [readingMode, nextNumber, editing, isCurrent, bookId, nav]);

  const handleStartEdit = () => {
    if (!data) return;
    setEditContent(data.content);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditContent("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      setEditing(false);
      refetch();
      setWorkspaceRevision((revision) => revision + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">Error: {error}</div>;
  if (!data || !isCurrent) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{t("reader.openingManuscript")}</span>
    </div>
  );

  // Split markdown content into title and body
  const lines = data.content.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const rawTitle = titleLine?.replace(/^#\s*/, "") ?? `Chapter ${chapterNumber}`;
  const title = stripChapterNumberPrefix(rawTitle) || rawTitle;
  const body = lines
    .filter((l) => l !== titleLine)
    .join("\n")
    .trim();

  const handleApprove = async () => {
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/approve`);
      if (readingMode && nextNumber !== undefined) {
        nav.toChapter(bookId, nextNumber);
      } else {
        nav.toBookSettings(bookId);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approve failed");
    }
  };

  const handleReject = async () => {
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/reject`);
      if (readingMode && nextNumber !== undefined) {
        nav.toChapter(bookId, nextNumber);
      } else {
        nav.toBookSettings(bookId);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reject failed");
    }
  };

  const handleCopy = async (kind: "title" | "body", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        return;
      }
    }
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  };

  const paragraphs = body.split(/\n\n+/).filter(Boolean);

  return (
    <div className="w-full space-y-10 fade-in">
      {/* Navigation & Actions */}
      {readingMode ? (
        /* ── 阅读模式：极简沉浸式工具栏（吸顶） ── */
        <div className="sticky top-0 z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 2xl:-mx-12 2xl:px-12 py-2.5 bg-background/85 backdrop-blur-md border-b border-border/40 flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            disabled={prevNumber === undefined}
            onClick={() => goToChapter(prevNumber)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-bold text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronLeft size={16} />
            {t("reader.prevChapter")}
          </button>
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70 px-1">
            {t("reader.chapterProgress").replace("{n}", String(chapterNumber)).replace("{total}", String(totalChapters))}
          </span>
          <button
            type="button"
            disabled={nextNumber === undefined}
            onClick={() => goToChapter(nextNumber)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-bold text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            {t("reader.nextChapter")}
            <ChevronRight size={16} />
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleApprove}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-500/10 text-emerald-600 rounded-lg hover:bg-emerald-500 hover:text-white transition-all border border-emerald-500/20"
            >
              <CheckCircle2 size={14} />
              {t("reader.approve")}
            </button>
            <button
              type="button"
              onClick={handleReject}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-destructive/10 text-destructive rounded-lg hover:bg-destructive hover:text-white transition-all border border-destructive/20"
            >
              <XCircle size={14} />
              {t("reader.reject")}
            </button>
            <button
              type="button"
              onClick={() => setReadingMode(false)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-muted-foreground hover:text-primary transition-colors rounded-lg"
              title={t("reader.exitReadingMode")}
            >
              <X size={14} />
              {t("reader.exitReadingMode")}
            </button>
          </div>
        </div>
      ) : (
        /* ── 普通模式：面包屑 + 完整操作栏 ── */
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <button
              onClick={nav.toDashboard}
              className="hover:text-primary transition-colors flex items-center gap-1"
            >
              {t("bread.books")}
            </button>
            <span className="text-border">/</span>
            <button
              onClick={() => nav.toBookSettings(bookId)}
              className="hover:text-primary transition-colors truncate max-w-[120px]"
            >
              {bookId}
            </button>
            <span className="text-border">/</span>
            <span className="text-foreground flex items-center gap-1">
              <Hash size={12} />
              {chapterNumber}
              {totalChapters > 0 && (
                <span className="text-muted-foreground/60">
                  / {totalChapters}
                </span>
              )}
            </span>
          </nav>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              aria-pressed={readingMode}
              onClick={() => setReadingMode(true)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all border shadow-sm bg-primary text-primary-foreground border-primary hover:bg-primary/90"
            >
              <BookOpenText size={14} />
              {t("reader.readingMode")}
            </button>

            <button
              onClick={() => nav.toBookSettings(bookId)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground hover:bg-secondary/80 transition-all border border-border/50"
            >
              <List size={14} />
              {t("reader.backToList")}
            </button>

            {/* Edit / Preview toggle */}
            {editing ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-primary text-primary-foreground rounded-xl hover:scale-105 active:scale-95 transition-all shadow-sm disabled:opacity-50"
                >
                  {saving ? <div className="w-3.5 h-3.5 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={14} />}
                  {saving ? t("book.saving") : t("book.save")}
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground transition-all border border-border/50"
                >
                  <Eye size={14} />
                  {t("reader.preview")}
                </button>
              </>
            ) : (
              <button
                onClick={handleStartEdit}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
              >
                <Pencil size={14} />
                {t("reader.edit")}
              </button>
            )}

            <button
              onClick={handleApprove}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-500/10 text-emerald-600 rounded-xl hover:bg-emerald-500 hover:text-white transition-all border border-emerald-500/20 shadow-sm"
            >
              <CheckCircle2 size={14} />
              {t("reader.approve")}
            </button>
            <button
              onClick={handleReject}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-destructive/10 text-destructive rounded-xl hover:bg-destructive hover:text-white transition-all border border-destructive/20 shadow-sm"
            >
              <XCircle size={14} />
              {t("reader.reject")}
            </button>
          </div>
        </div>
      )}

      {!readingMode && (
        <ChapterWorkspacePanel
          key={`${chapterNumber}-${workspaceRevision}`}
          bookId={bookId}
          chapterNumber={chapterNumber}
          t={t}
          onChapterChanged={refetch}
          onChapterDeleted={() => nav.toBookSettings(bookId)}
        />
      )}

      {/* Manuscript Sheet */}
      <div className={`paper-sheet rounded-2xl p-6 md:p-12 lg:p-20 shadow-2xl shadow-primary/5 min-h-[80vh] relative overflow-hidden ${readingMode ? "mx-auto max-w-3xl" : ""}`}>
        {/* Physical Paper Details */}
        <div className="absolute top-0 left-8 w-px h-full bg-primary/5 hidden md:block" />
        <div className="absolute top-0 right-8 w-px h-full bg-primary/5 hidden md:block" />

        <header className="mb-16 text-center">
          <div className="flex items-center justify-center gap-2 mb-8">
            <button
              type="button"
              onClick={() => void handleCopy("title", title)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-border/50 bg-secondary/50 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            >
              <Copy size={13} />
              {copied === "title" ? t("reader.copied") : t("reader.copyTitle")}
            </button>
            <button
              type="button"
              onClick={() => void handleCopy("body", body)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-border/50 bg-secondary/50 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            >
              <Copy size={13} />
              {copied === "body" ? t("reader.copied") : t("reader.copyBody")}
            </button>
          </div>
          <div className="flex items-center justify-center gap-2 text-muted-foreground/30 mb-8 select-none">
            <div className="h-px w-12 bg-border/40" />
            <BookOpen size={20} />
            <div className="h-px w-12 bg-border/40" />
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-medium italic text-foreground tracking-tight leading-tight">
            {rawTitle}
          </h1>
          <div className="mt-8 flex items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
            <span>{t("reader.manuscriptPage")}</span>
            <span className="text-border">·</span>
            <span>{chapterNumber.toString().padStart(2, '0')}</span>
          </div>
        </header>

        {editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[60vh] bg-transparent font-serif text-lg leading-[1.8] text-foreground/90 focus:outline-none resize-none border border-border/30 rounded-lg p-6 focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
            autoFocus
          />
        ) : (
          <article className="prose prose-zinc dark:prose-invert max-w-none">
            {paragraphs.map((para, i) => (
              <p key={i} className={`font-serif leading-[1.9] text-foreground/90 mb-8 ${readingMode ? "text-xl md:text-2xl" : "text-lg md:text-xl"}`}>
                {para}
              </p>
            ))}
          </article>
        )}

        <footer className="mt-24 pt-12 border-t border-border/20 flex flex-col items-center gap-6 text-center">
          <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Type size={14} className="text-primary/60" />
               <span>{body.length.toLocaleString()} {t("reader.characters")}</span>
             </div>
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Clock size={14} className="text-primary/60" />
               <span>{Math.ceil(body.length / 500)} {t("reader.minRead")}</span>
             </div>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-bold">{t("reader.endOfChapter")}</p>
        </footer>
      </div>

      {/* Footer Navigation */}
      <div className="flex justify-between items-center gap-3 py-8">
        <button
          type="button"
          disabled={prevNumber === undefined}
          onClick={() => goToChapter(prevNumber)}
          className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronLeft size={16} />
          {t("reader.prevChapter")}
        </button>
        <button
          type="button"
          onClick={() => nav.toBookSettings(bookId)}
          className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground/70 hover:text-primary transition-colors"
        >
          <List size={14} />
          {t("reader.chapterList")}
        </button>
        <button
          type="button"
          disabled={nextNumber === undefined}
          onClick={() => goToChapter(nextNumber)}
          className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          {t("reader.nextChapter")}
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 底部操作：读完不用滚回顶部 */}
      <div className="flex items-center justify-center gap-3 flex-wrap py-6 border-t border-border/40">
        <button
          type="button"
          onClick={handleApprove}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-emerald-500/10 text-emerald-600 rounded-xl hover:bg-emerald-500 hover:text-white transition-all border border-emerald-500/30 shadow-sm"
        >
          <CheckCircle2 size={16} />
          {t("reader.approve")}
        </button>
        <button
          type="button"
          onClick={handleReject}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-destructive/10 text-destructive rounded-xl hover:bg-destructive hover:text-white transition-all border border-destructive/30 shadow-sm"
        >
          <XCircle size={16} />
          {t("reader.reject")}
        </button>
      </div>

      {/* 阅读模式：本章末尾的续读卡片（同时是自动续读的哨兵） */}
      {readingMode && nextNumber !== undefined && (
        <div ref={endSentinelRef} className="paper-sheet rounded-2xl p-8 text-center space-y-4 fade-in">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-bold">{t("reader.endOfChapter")}</p>
          <button
            type="button"
            onClick={() => goToChapter(nextNumber)}
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold bg-primary text-primary-foreground rounded-xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/20"
          >
            {t("reader.continueReading")}
            <ChevronRight size={16} />
          </button>
          <p className="text-xs text-muted-foreground/50">{t("reader.autoContinueHint")}</p>
        </div>
      )}

      {readingMode && nextNumber === undefined && (
        <div className="paper-sheet rounded-2xl p-8 text-center fade-in">
          <p className="text-xs uppercase tracking-widest text-muted-foreground/60 font-bold">{t("reader.endOfBook")}</p>
        </div>
      )}
    </div>
  );
}

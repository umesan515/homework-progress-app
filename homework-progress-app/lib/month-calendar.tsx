"use client";

import { useEffect, useMemo, useState } from "react";

export type CalendarEvent = {
  id: string;
  date: string; // YYYY-MM-DD (local)
  title: string;
  kind: "due" | "test";
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export const toYMDLocal = (isoOrDate: string | Date) => {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const addMonths = (y: number, m0: number, delta: number) => {
  const d = new Date(y, m0 + delta, 1);
  return { y: d.getFullYear(), m0: d.getMonth() };
};

const startOfMonth = (y: number, m0: number) => new Date(y, m0, 1);
const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

const weekdayLabel = ["月", "火", "水", "木", "金", "土", "日"]; // Monday start
const weekdayIndexMon0 = (d: Date) => (d.getDay() + 6) % 7; // JS: Sun=0..Sat=6 => Mon=0..Sun=6

type HolidayMap = Record<string, string>; // "YYYY-MM-DD" -> "祝日名"

async function fetchHolidaysForYear(year: number): Promise<HolidayMap> {
  // holidays-jp は year パラメータで当該年の祝日を返せる
  // 失敗した場合はフォールバックとして year なしのdate.jsonも試す（直近年しか無い場合でも最低限動かす）
  const urlYear = `https://holidays-jp.github.io/api/v1/date.json?year=${year}`;
  const urlDefault = `https://holidays-jp.github.io/api/v1/date.json`;

  const tryFetch = async (url: string) => {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new Error(`holiday fetch failed: ${res.status}`);
    const json = (await res.json()) as HolidayMap;
    return json && typeof json === "object" ? json : {};
  };

  try {
    return await tryFetch(urlYear);
  } catch {
    return await tryFetch(urlDefault);
  }
}

export function MonthCalendar(props: {
  title?: string;
  events: CalendarEvent[];
  initialMonth?: string; // YYYY-MM
  onDayClick?: (ymd: string) => void;
  /** true のとき、コンポーネント内部にタイトル行を出さない（呼び出し側で見出しを外に出す用途） */
  headingOutside?: boolean;
}) {
  const todayYmd = toYMDLocal(new Date());

  const initial = (() => {
    if (props.initialMonth && /^\d{4}-\d{2}$/.test(props.initialMonth)) {
      const [y, mm] = props.initialMonth.split("-").map((x) => Number(x));
      return { y, m0: mm - 1 };
    }
    const now = new Date();
    return { y: now.getFullYear(), m0: now.getMonth() };
  })();

  const [view, setView] = useState<{ y: number; m0: number }>(initial);
  const [selectedDay, setSelectedDay] = useState<string>(todayYmd);

  // 祝日キャッシュ（年単位で保持）
  const [holidayByYear, setHolidayByYear] = useState<Record<number, HolidayMap>>({});
  const holidays: HolidayMap = holidayByYear[view.y] ?? {};

  useEffect(() => {
    let cancelled = false;
    const y = view.y;
    if (holidayByYear[y]) return;

    fetchHolidaysForYear(y)
      .then((m) => {
        if (cancelled) return;
        setHolidayByYear((prev) => ({ ...prev, [y]: m }));
      })
      .catch(() => {
        if (cancelled) return;
        setHolidayByYear((prev) => ({ ...prev, [y]: {} }));
      });

    return () => {
      cancelled = true;
    };
  }, [view.y, holidayByYear]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of props.events ?? []) {
      if (!ev?.date) continue;
      if (!map.has(ev.date)) map.set(ev.date, []);
      map.get(ev.date)!.push(ev);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) =>
        a.kind === b.kind ? a.title.localeCompare(b.title, "ja") : a.kind.localeCompare(b.kind)
      );
      map.set(k, arr);
    }
    return map;
  }, [props.events]);

  const grid = useMemo(() => {
    const first = startOfMonth(view.y, view.m0);
    const firstW = weekdayIndexMon0(first); // 0..6
    const dim = daysInMonth(view.y, view.m0);

    const cells: Array<{ ymd: string; day: number; inMonth: boolean }> = [];

    // 前月埋め
    const prev = addMonths(view.y, view.m0, -1);
    const dimPrev = daysInMonth(prev.y, prev.m0);
    for (let i = 0; i < firstW; i++) {
      const day = dimPrev - (firstW - 1 - i);
      const d = new Date(prev.y, prev.m0, day);
      cells.push({ ymd: toYMDLocal(d), day, inMonth: false });
    }

    // 当月
    for (let day = 1; day <= dim; day++) {
      const d = new Date(view.y, view.m0, day);
      cells.push({ ymd: toYMDLocal(d), day, inMonth: true });
    }

    // 次月埋め（6週=42マスに揃える）
    const next = addMonths(view.y, view.m0, +1);
    while (cells.length % 7 !== 0) {
      const day = cells.length - (firstW + dim) + 1;
      const d = new Date(next.y, next.m0, day);
      cells.push({ ymd: toYMDLocal(d), day, inMonth: false });
    }
    while (cells.length < 42) {
      const day = cells.length - (firstW + dim) + 1;
      const d = new Date(next.y, next.m0, day);
      cells.push({ ymd: toYMDLocal(d), day, inMonth: false });
    }

    return cells;
  }, [view.y, view.m0]);

  const selectedEvents = eventsByDate.get(selectedDay) ?? [];

  return (
    <div className="rounded-2xl bg-gray-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {!props.headingOutside && (
            <div className="font-semibold">{props.title ?? "カレンダー"}</div>
          )}
          <div className="text-sm text-gray-600">
            {view.y}年 {view.m0 + 1}月
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition"
            onClick={() => setView(addMonths(view.y, view.m0, -1))}
            aria-label="前の月"
          >
            ＜
          </button>
          <button
            className="rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition"
            onClick={() => {
              const now = new Date();
              setView({ y: now.getFullYear(), m0: now.getMonth() });
              setSelectedDay(toYMDLocal(now));
            }}
          >
            今月
          </button>
          <button
            className="rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition"
            onClick={() => setView(addMonths(view.y, view.m0, +1))}
            aria-label="次の月"
          >
            ＞
          </button>
        </div>
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-3 text-xs text-gray-600 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> 課題期限
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> テスト
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> 祝日
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> 今日
        </span>
      </div>

      {/* 曜日 */}
      <div className="grid grid-cols-7 gap-1 text-xs text-gray-500">
        {weekdayLabel.map((w, i) => {
          const isSat = i === 5;
          const isSun = i === 6;
          return (
            <div
              key={w}
              className={[
                "text-center py-1",
                isSat ? "text-blue-600" : "",
                isSun ? "text-red-600" : "",
              ].join(" ")}
            >
              {w}
            </div>
          );
        })}
      </div>

      {/* 日付セル */}
      <div className="grid grid-cols-7 gap-1">
        {grid.map((c, idx) => {
          const evs = eventsByDate.get(c.ymd) ?? [];
          const hasDue = evs.some((e) => e.kind === "due");
          const hasTest = evs.some((e) => e.kind === "test");

          // ✅ 月曜始まりの列 index: 0..6（5=土, 6=日）
          const col = idx % 7;
          const isSat = col === 5;
          const isSun = col === 6;

          const isToday = c.ymd === todayYmd;
          const isSelected = c.ymd === selectedDay;
          const isHoliday = !!holidays[c.ymd];

          const onClick = () => {
            setSelectedDay(c.ymd);
            props.onDayClick?.(c.ymd);
          };

          return (
            <button
              key={c.ymd}
              type="button"
              onClick={onClick}
              className={[
                "relative rounded-lg border px-2 py-2 text-left min-h-[56px] transition",
                c.inMonth ? "bg-white" : "bg-gray-50 text-gray-400",
                // 週末/祝日/今日：薄い枠色
                isSat ? "border-blue-200" : "",
                (isSun || isHoliday) ? "border-red-200" : "",
                isToday ? "border-emerald-200" : "",
                isSelected ? "ring-2 ring-gray-300" : "hover:bg-gray-100",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <div
                  className={[
                    "text-sm font-semibold",
                    isSun || isHoliday ? "text-red-600" : "",
                    isSat ? "text-blue-600" : "",
                  ].join(" ")}
                >
                  {c.day}
                </div>

                <div className="flex items-center gap-1">
                  {isToday && <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="今日" />}
                  {isHoliday && <span className="inline-block h-2 w-2 rounded-full bg-red-500" title={holidays[c.ymd]} />}
                  {hasDue && <span className="inline-block h-2 w-2 rounded-full bg-blue-500" title="課題期限" />}
                  {hasTest && <span className="inline-block h-2 w-2 rounded-full bg-rose-500" title="テスト" />}
                </div>
              </div>

              {/* 祝日名（赤い点だけでなく名称も表示） */}
              {isHoliday && (
                <div className="mt-1 text-[11px] truncate" title={holidays[c.ymd]}>
                  <span className="inline-block rounded px-1 py-[1px] bg-red-50 text-red-700">
                    {holidays[c.ymd]}
                  </span>
                </div>
              )}

              {evs.length > 0 && (
                <div className="mt-1 space-y-1">
                  {evs.slice(0, 2).map((e) => (
                    <div key={e.id} className="text-[11px] text-gray-700 truncate">
                      {e.title}
                    </div>
                  ))}
                  {evs.length > 2 && <div className="text-[11px] text-gray-500">ほか {evs.length - 2}件</div>}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* 選択日の詳細 */}
      <div className="rounded-xl border bg-white p-3">
        <div className="text-sm font-semibold">{selectedDay}</div>
        {holidays[selectedDay] && (
          <div className="text-sm text-red-600 mt-1">{holidays[selectedDay]}</div>
        )}
        {selectedEvents.length === 0 ? (
          <div className="text-sm text-gray-600 mt-1">予定はありません。</div>
        ) : (
          <ul className="text-sm mt-2 space-y-1">
            {selectedEvents.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <span className={e.kind === "due" ? "text-blue-600" : "text-rose-600"}>●</span>
                <span>{e.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

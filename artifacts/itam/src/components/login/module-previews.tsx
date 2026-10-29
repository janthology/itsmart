import { useState, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Monitor, Laptop, Smartphone, TrendingUp } from "lucide-react";

function GridLines() {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between px-1 py-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="border-t border-white/[0.06]" />
      ))}
    </div>
  );
}

function MiniDashShell({
  label,
  value,
  trend,
  accent,
  children,
}: {
  label: string;
  value: string;
  trend?: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[hsl(207_30%_8%/0.85)] shadow-inner">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-2.5 py-1.5">
        <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/35">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold tabular-nums text-white/85">{value}</span>
          {trend && (
            <span className={`flex items-center gap-0.5 text-[7px] font-semibold ${accent}`}>
              <TrendingUp className="h-2.5 w-2.5" />
              {trend}
            </span>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1 p-2">{children}</div>
    </div>
  );
}

const TICKET_STATUS_SUMMARY = [
  { label: "Open", count: 8, dot: "bg-amber-400", text: "text-amber-300" },
  { label: "Active", count: 5, dot: "bg-sky-400", text: "text-sky-300" },
  { label: "Done", count: 11, dot: "bg-emerald-400", text: "text-emerald-300" },
];

const TICKET_ROWS = [
  {
    id: "#1042",
    title: "Laptop won't boot",
    status: "Open",
    progress: 20,
    bar: "bg-amber-400",
    badge: "bg-amber-500/20 text-amber-300 ring-amber-400/30",
    rowBg: "border-amber-400/20 bg-amber-500/[0.06]",
  },
  {
    id: "#1043",
    title: "Printer offline",
    status: "In progress",
    progress: 65,
    bar: "bg-sky-400",
    badge: "bg-sky-500/20 text-sky-300 ring-sky-400/30",
    rowBg: "border-sky-400/20 bg-sky-500/[0.06]",
  },
  {
    id: "#1044",
    title: "Email access issue",
    status: "Resolved",
    progress: 100,
    bar: "bg-emerald-400",
    badge: "bg-emerald-500/20 text-emerald-300 ring-emerald-400/30",
    rowBg: "border-emerald-400/20 bg-emerald-500/[0.06]",
  },
];

export function TicketsPreview({ isActive }: { isActive: boolean }) {
  const [activeRow, setActiveRow] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActiveRow((i) => (i + 1) % TICKET_ROWS.length), isActive ? 2200 : 3800);
    return () => clearInterval(t);
  }, [isActive]);

  return (
    <MiniDashShell label="Support queue" value="24 tickets" trend="+3 today" accent="text-amber-400">
      <div className="flex h-full flex-col gap-1.5 py-0.5">
        {/* Status breakdown */}
        <div className="flex shrink-0 gap-1">
          {TICKET_STATUS_SUMMARY.map((s) => (
            <div
              key={s.label}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.03] py-1"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
              <span className={`text-[8px] font-bold tabular-nums ${s.text}`}>{s.count}</span>
              <span className="text-[7px] text-white/30">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Ticket rows */}
        {TICKET_ROWS.map((row, i) => {
          const highlighted = i === activeRow;
          return (
            <motion.div
              key={row.id}
              animate={{ opacity: highlighted ? 1 : 0.5, scale: highlighted ? 1 : 0.98 }}
              transition={{ duration: 0.3 }}
              className={`rounded-md border px-2 py-1.5 ${highlighted ? row.rowBg : "border-white/[0.06] bg-white/[0.03]"}`}
            >
              <div className="flex items-start justify-between gap-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[8px] font-mono font-bold text-white/50">{row.id}</span>
                    <span className={`rounded px-1 py-px text-[7px] font-semibold ring-1 ${row.badge}`}>
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[9px] font-medium text-white/85">{row.title}</p>
                </div>
                <span className="shrink-0 text-[8px] font-bold tabular-nums text-white/40">{row.progress}%</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-[7px] text-white/25 shrink-0">Progress</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <motion.div
                    className={`h-full rounded-full ${row.bar}`}
                    initial={{ width: 0 }}
                    animate={{
                      width: highlighted && isActive
                        ? [`${row.progress}%`, `${Math.max(row.progress - 8, 5)}%`, `${row.progress}%`]
                        : `${row.progress}%`,
                    }}
                    transition={{
                      duration: highlighted && isActive ? 2 : 0.7,
                      repeat: highlighted && isActive ? Infinity : 0,
                      delay: i * 0.1,
                      ease: "easeOut",
                    }}
                  />
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </MiniDashShell>
  );
}

const ASSET_FLEET = [
  {
    Icon: Laptop,
    label: "Laptops",
    count: 48,
    pct: 49,
    from: "from-sky-400",
    to: "to-cyan-500",
    chip: "bg-sky-500/20 text-sky-300 ring-sky-400/30",
  },
  {
    Icon: Monitor,
    label: "Desktops",
    count: 31,
    pct: 32,
    from: "from-cyan-400",
    to: "to-teal-500",
    chip: "bg-cyan-500/20 text-cyan-300 ring-cyan-400/30",
  },
  {
    Icon: Smartphone,
    label: "Mobile",
    count: 19,
    pct: 19,
    from: "from-blue-400",
    to: "to-indigo-500",
    chip: "bg-blue-500/20 text-blue-300 ring-blue-400/30",
  },
];

export function AssetsPreview({ isActive }: { isActive: boolean }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive((i) => (i + 1) % ASSET_FLEET.length), isActive ? 2400 : 4000);
    return () => clearInterval(t);
  }, [isActive]);

  const focus = ASSET_FLEET[active];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-sky-500/15 bg-gradient-to-br from-sky-950/80 via-[hsl(200_30%_10%)] to-[hsl(210_25%_8%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-2.5 py-2">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-sky-300/70">Fleet mix</p>
          <p className="text-[11px] font-semibold text-white/90">98 assets tracked</p>
        </div>
        <motion.div
          animate={isActive ? { scale: [1, 1.06, 1] } : {}}
          transition={{ duration: 2.2, repeat: Infinity }}
          className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[8px] font-bold text-emerald-300 ring-1 ring-emerald-400/25"
        >
          94% healthy
        </motion.div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 px-2.5 py-2">
        {/* Unified composition bar */}
        <div className="overflow-hidden rounded-full bg-white/[0.06] p-0.5">
          <div className="flex h-2.5 overflow-hidden rounded-full">
            {ASSET_FLEET.map((seg, i) => (
              <motion.div
                key={seg.label}
                initial={{ width: 0 }}
                animate={{
                  width: `${seg.pct}%`,
                  opacity: i === active ? 1 : 0.72,
                  scaleY: i === active && isActive ? [1, 1.15, 1] : 1,
                }}
                transition={{
                  width: { duration: 0.8, delay: i * 0.08, ease: "easeOut" },
                  scaleY: { duration: 1.6, repeat: i === active && isActive ? Infinity : 0 },
                }}
                className={`bg-gradient-to-r ${seg.from} ${seg.to} ${i === 0 ? "rounded-l-full" : ""} ${
                  i === ASSET_FLEET.length - 1 ? "rounded-r-full" : ""
                }`}
              />
            ))}
          </div>
        </div>

        {/* Active focus readout */}
        <AnimatePresence mode="wait">
          <motion.div
            key={focus.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.04] px-2 py-1.5"
          >
            <div className="flex items-center gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${focus.from} ${focus.to} shadow-[0_4px_12px_rgba(56,189,248,0.35)]`}>
                <focus.Icon className="h-3.5 w-3.5 text-white" />
              </div>
              <div>
                <p className="text-[9px] font-semibold text-white/85">{focus.label}</p>
                <p className="text-[7px] text-sky-300/55">{focus.pct}% of fleet</p>
              </div>
            </div>
            <motion.span
              animate={isActive ? { scale: [1, 1.08, 1] } : {}}
              transition={{ duration: 1.8, repeat: Infinity }}
              className="text-sm font-display font-bold tabular-nums text-white"
            >
              {focus.count}
            </motion.span>
          </motion.div>
        </AnimatePresence>

        {/* Device chips */}
        <div className="grid grid-cols-3 gap-1">
          {ASSET_FLEET.map((seg, i) => {
            const selected = i === active;
            return (
              <motion.button
                key={seg.label}
                type="button"
                onClick={() => setActive(i)}
                animate={{ scale: selected ? 1.04 : 1, y: selected ? -1 : 0 }}
                className="relative flex flex-col items-center rounded-lg py-1.5 outline-none"
              >
                {selected && (
                  <motion.div
                    layoutId="asset-pill"
                    className={`absolute inset-0 rounded-lg ring-1 ${seg.chip}`}
                    transition={{ type: "spring", stiffness: 380, damping: 28 }}
                  />
                )}
                <seg.Icon className={`relative z-10 h-3 w-3 ${selected ? "text-white" : "text-white/40"}`} />
                <span className={`relative z-10 mt-0.5 text-[8px] font-bold tabular-nums ${selected ? "text-white" : "text-white/45"}`}>
                  {seg.count}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* Crypto-style zigzag: starts low left, climbs to top right */
const CRYPTO_LINE =
  "M2,36 L12,33 L22,35 L32,28 L42,30 L52,24 L62,26 L72,19 L82,21 L92,14 L98,9";
const CRYPTO_AREA = `${CRYPTO_LINE} L98,40 L2,40 Z`;
const TIP_X = 98;
const TIP_Y = 9;

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export function ReportsPreview({ isActive }: { isActive: boolean }) {
  const cycleDuration = isActive ? 3.4 : 5;

  return (
    <MiniDashShell label="Analytics" value="1,284" trend="+8.2%" accent="text-emerald-400">
      <div className="relative flex h-full min-h-[62px] flex-col">
        <GridLines />

        <div className="relative mt-0.5 flex-1 overflow-hidden rounded-md">
          <svg
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            viewBox="0 0 100 40"
          >
            <defs>
              <linearGradient id="reportsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(52,211,153)" stopOpacity="0.55" />
                <stop offset="100%" stopColor="rgb(52,211,153)" stopOpacity="0" />
              </linearGradient>
              <filter id="lineGlow">
                <feGaussianBlur stdDeviation="1.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Area fill — fades in as line climbs */}
            <motion.path
              d={CRYPTO_AREA}
              fill="url(#reportsAreaGrad)"
              animate={{ opacity: [0, 0, 0.55, 0.55, 0] }}
              transition={{
                duration: cycleDuration,
                times: [0, 0.55, 0.65, 0.82, 1],
                repeat: Infinity,
                ease: "easeOut",
              }}
            />

            {/* Zigzag line draws left → right, climbing up */}
            <motion.path
              d={CRYPTO_LINE}
              fill="none"
              stroke="rgb(110,231,183)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#lineGlow)"
              initial={{ pathLength: 0, opacity: 0.6 }}
              animate={{ pathLength: [0, 1, 1, 0], opacity: [0.6, 1, 1, 0.6] }}
              transition={{
                duration: cycleDuration,
                times: [0, 0.65, 0.82, 1],
                repeat: Infinity,
                ease: "easeOut",
              }}
            />

            {/* Live tip dot — crypto pulse */}
            <motion.circle
              r="3"
              fill="rgb(167,243,208)"
              cx={TIP_X}
              cy={TIP_Y}
              animate={{
                opacity: [0, 0, 1, 1, 0],
                scale: [0, 0, 1, 1.2, 0],
                cy: [TIP_Y, TIP_Y, TIP_Y, TIP_Y - 1, TIP_Y],
              }}
              transition={{
                duration: cycleDuration,
                times: [0, 0.6, 0.65, 0.8, 1],
                repeat: Infinity,
              }}
            />
            <motion.circle
              r="5"
              fill="none"
              stroke="rgb(52,211,153)"
              strokeWidth="1"
              cx={TIP_X}
              cy={TIP_Y}
              animate={{
                opacity: [0, 0, 0.6, 0],
                scale: [0.5, 0.5, 1.8, 2.2],
              }}
              transition={{
                duration: cycleDuration,
                times: [0, 0.65, 0.78, 0.9],
                repeat: Infinity,
              }}
            />
          </svg>
        </div>

        <div className="relative z-10 mt-1 flex justify-between px-1">
          {DAY_LABELS.map((label, i) => (
            <span key={i} className="flex-1 text-center text-[7px] font-medium text-emerald-300/45">
              {label}
            </span>
          ))}
        </div>
      </div>
    </MiniDashShell>
  );
}

const WEEK_DAYS = [
  { label: "M", date: 6, events: 0 },
  { label: "T", date: 7, events: 1 },
  { label: "W", date: 8, events: 0 },
  { label: "T", date: 9, events: 0 },
  { label: "F", date: 10, events: 2 },
  { label: "S", date: 11, events: 0 },
  { label: "S", date: 12, events: 1 },
];

const DAY_EVENTS: Record<number, { title: string; time: string; color: string }[]> = {
  7: [{ title: "Ticket review", time: "9:00 AM", color: "from-violet-500 to-purple-600" }],
  10: [
    { title: "PM maintenance", time: "10:00 AM", color: "from-fuchsia-500 to-violet-600" },
    { title: "Asset handover", time: "2:30 PM", color: "from-purple-500 to-indigo-600" },
  ],
  12: [{ title: "Team sync", time: "11:00 AM", color: "from-violet-400 to-fuchsia-500" }],
};

export function CalendarPreview({ isActive }: { isActive: boolean }) {
  const [selected, setSelected] = useState(4); // Friday the 10th

  useEffect(() => {
    const eventDays = WEEK_DAYS.map((d, i) => (DAY_EVENTS[d.date]?.length ? i : -1)).filter((i) => i >= 0);
    if (!eventDays.length) return;
    const t = setInterval(
      () => setSelected((s) => eventDays[(eventDays.indexOf(s) + 1) % eventDays.length]),
      isActive ? 2800 : 4500
    );
    return () => clearInterval(t);
  }, [isActive]);

  const activeDay = WEEK_DAYS[selected];
  const events = DAY_EVENTS[activeDay.date] ?? [];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-violet-500/15 bg-gradient-to-br from-violet-950/80 via-[hsl(270_30%_10%)] to-[hsl(260_25%_8%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-2.5 py-2">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-violet-300/70">October</p>
          <p className="text-[11px] font-semibold text-white/90">This week</p>
        </div>
        <motion.div
          animate={isActive ? { scale: [1, 1.05, 1] } : {}}
          transition={{ duration: 2, repeat: Infinity }}
          className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[8px] font-bold text-violet-200 ring-1 ring-violet-400/25"
        >
          4 events
        </motion.div>
      </div>

      {/* Week strip */}
      <div className="flex shrink-0 gap-1 px-2 py-2">
        {WEEK_DAYS.map((day, i) => {
          const isSel = i === selected;
          const hasEvents = (DAY_EVENTS[day.date]?.length ?? 0) > 0;
          return (
            <motion.button
              key={`${day.label}-${day.date}`}
              type="button"
              onClick={() => setSelected(i)}
              animate={{ scale: isSel ? 1.05 : 1 }}
              className="relative flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 outline-none"
            >
              {isSel && (
                <motion.div
                  layoutId="cal-pill"
                  className="absolute inset-0 rounded-lg bg-gradient-to-b from-violet-500/90 to-fuchsia-600/80 shadow-[0_4px_12px_rgba(139,92,246,0.45)]"
                  transition={{ type: "spring", stiffness: 380, damping: 28 }}
                />
              )}
              <span className={`relative z-10 text-[7px] font-semibold ${isSel ? "text-white/90" : "text-white/35"}`}>
                {day.label}
              </span>
              <span className={`relative z-10 text-[10px] font-bold tabular-nums ${isSel ? "text-white" : "text-white/55"}`}>
                {day.date}
              </span>
              {hasEvents && !isSel && (
                <span className="relative z-10 h-1 w-1 rounded-full bg-violet-400" />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Events list */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-2 pb-2">
        <AnimatePresence mode="wait">
          {events.length > 0 ? (
            <motion.div
              key={activeDay.date}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-1"
            >
              {events.map((ev, i) => (
                <motion.div
                  key={ev.title}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.04] px-2 py-1.5"
                >
                  <div className={`h-7 w-1 shrink-0 rounded-full bg-gradient-to-b ${ev.color}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[9px] font-semibold text-white/85">{ev.title}</p>
                    <p className="text-[7px] text-violet-300/60">{ev.time}</p>
                  </div>
                  {isActive && (
                    <motion.span
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.2 }}
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400"
                    />
                  )}
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-2"
            >
              <p className="text-[8px] font-medium text-white/30">No events</p>
              <p className="text-[7px] text-white/20">Pick a highlighted day</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function ModulePreview({ type, isActive }: { type: string; isActive: boolean }) {
  switch (type) {
    case "tickets":
      return <TicketsPreview isActive={isActive} />;
    case "assets":
      return <AssetsPreview isActive={isActive} />;
    case "reports":
      return <ReportsPreview isActive={isActive} />;
    case "calendar":
      return <CalendarPreview isActive={isActive} />;
    default:
      return null;
  }
}

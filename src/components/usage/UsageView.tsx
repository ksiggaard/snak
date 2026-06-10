import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { dailyUsage, usageByModel, type UsageByModel } from "@/lib/db";
import {
  buildHeatmap,
  formatTokens,
  monthLabelColumns,
  type HeatmapCell,
  type HeatmapWeek,
} from "@/lib/usage";
import { PROVIDERS } from "@/lib/providers";

type SortKey = "model" | "total_tokens" | "last_used";
type SortDir = "asc" | "desc";

const providerLabel = (id: string) =>
  PROVIDERS.find((p) => p.id === id)?.label ?? id;

/** Tailwind background per heat level (uses the theme `primary` token). */
const LEVEL_BG = [
  "bg-muted",
  "bg-primary/25",
  "bg-primary/50",
  "bg-primary/75",
  "bg-primary",
] as const;

// Cell size in px (matches Tailwind `size-3` = 12px) plus gap (4px = gap-1).
const CELL_SIZE = 12;
const CELL_GAP = 4;
const COL_STRIDE = CELL_SIZE + CELL_GAP;

/** Heatmap that adapts to its container width via ResizeObserver. */
function ActivityHeatmap({ allWeeks }: { allWeeks: HeatmapWeek[] }) {
  const [containerWidth, setContainerWidth] = useState(0);

  // Callback ref: wires up/tears down a ResizeObserver whenever the element
  // mounts or unmounts, so column count stays in sync with container width.
  const observe = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute how many columns fit in the available width.
  const maxCols = containerWidth > 0
    ? Math.max(1, Math.floor((containerWidth + CELL_GAP) / COL_STRIDE))
    : allWeeks.length;

  // Take only the last maxCols weeks (most recent).
  const weeks = allWeeks.slice(-maxCols);
  const labels = useMemo(() => monthLabelColumns(weeks), [weeks]);

  // Build a lookup: colIndex → label, using the slice-adjusted index.
  const labelMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const { colIndex, label } of labels) m.set(colIndex, label);
    return m;
  }, [labels]);

  return (
    <div ref={observe} className="w-full overflow-hidden">
      {/* Month label row */}
      <div className="relative mb-1 flex" style={{ height: "1rem" }}>
        {weeks.map((_, wi) => {
          const lbl = labelMap.get(wi);
          if (!lbl) return null;
          return (
            <div
              key={wi}
              className="text-muted-foreground absolute text-[10px] leading-none"
              style={{ left: wi * COL_STRIDE }}
            >
              {lbl}
            </div>
          );
        })}
      </div>

      {/* Week columns */}
      <div className="flex gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((cell, di) =>
              cell === null ? (
                <div key={di} className="size-3" />
              ) : (
                <DayCell key={di} cell={cell} />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A single day cell with a styled tooltip. */
function DayCell({ cell }: { cell: HeatmapCell }) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  function handleMouseEnter(e: React.MouseEvent<HTMLDivElement>) {
    setAnchorRect(e.currentTarget.getBoundingClientRect());
  }

  function handleMouseLeave() {
    setAnchorRect(null);
  }

  return (
    <>
      <div
        className={`size-3 cursor-default rounded-sm ${LEVEL_BG[cell.level]}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
      {anchorRect && <DayTooltip cell={cell} anchorRect={anchorRect} />}
    </>
  );
}

/** Absolutely-positioned tooltip using popover/design tokens. */
function DayTooltip({
  cell,
  anchorRect,
}: {
  cell: HeatmapCell;
  anchorRect: DOMRect;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    visibility: "hidden",
  });

  useEffect(() => {
    if (!ref.current) return;
    const tip = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer above the cell; fall back to below.
    const GAP = 6;
    const CELL_H = 12;
    let top = anchorRect.top - tip.height - GAP;
    if (top < 4) top = anchorRect.top + CELL_H + GAP;

    // Keep horizontally in viewport.
    let left = anchorRect.left + CELL_H / 2 - tip.width / 2;
    if (left + tip.width > vw - 4) left = vw - tip.width - 4;
    if (left < 4) left = 4;

    // Keep vertically in viewport.
    if (top + tip.height > vh - 4) top = vh - tip.height - 4;

    setStyle({ position: "fixed", top, left, visibility: "visible" });
  }, [anchorRect]);

  const hasBreakdown =
    cell.input_tokens > 0 || cell.output_tokens > 0 || cell.cache_tokens > 0;

  return (
    <div
      ref={ref}
      className="bg-popover text-popover-foreground border-border z-50 min-w-[10rem] rounded-md border px-3 py-2 shadow-md"
      style={style}
      role="tooltip"
    >
      <p className="mb-1 text-xs font-semibold">{cell.day}</p>
      {hasBreakdown ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">Input</dt>
          <dd className="text-right tabular-nums">
            {formatTokens(cell.input_tokens)}
          </dd>
          <dt className="text-muted-foreground">Output</dt>
          <dd className="text-right tabular-nums">
            {formatTokens(cell.output_tokens)}
          </dd>
          {cell.cache_tokens > 0 && (
            <>
              <dt className="text-muted-foreground">Cache</dt>
              <dd className="text-right tabular-nums">
                {formatTokens(cell.cache_tokens)}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground border-border mt-1 border-t pt-1">
            Total
          </dt>
          <dd className="border-border mt-1 border-t pt-1 text-right font-medium tabular-nums">
            {formatTokens(cell.total_tokens)}
          </dd>
        </dl>
      ) : (
        <p className="text-muted-foreground text-xs">No activity</p>
      )}
      {cell.responses > 0 && (
        <p className="text-muted-foreground mt-1 text-xs">
          {cell.responses} response{cell.responses !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

/** The token-usage view (T16): a sortable per-model table + activity heatmap. */
export function UsageView() {
  const [rows, setRows] = useState<UsageByModel[]>([]);
  const [allWeeks, setAllWeeks] = useState<HeatmapWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("total_tokens");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [byModel, daily] = await Promise.all([
        usageByModel(),
        dailyUsage(),
      ]);
      if (!alive) return;
      setRows(byModel);
      setAllWeeks(buildHeatmap(daily, 365).weeks);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const cmp =
        sortKey === "model"
          ? a.model.localeCompare(b.model)
          : sortKey === "last_used"
            ? a.last_used.localeCompare(b.last_used)
            : a.total_tokens - b.total_tokens;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          input: acc.input + r.input_tokens,
          output: acc.output + r.output_tokens,
          cache: acc.cache + r.cache_creation_tokens + r.cache_read_tokens,
          total: acc.total + r.total_tokens,
          responses: acc.responses + r.responses,
        }),
        { input: 0, output: 0, cache: 0, total: 0, responses: 0 },
      ),
    [rows],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible default direction per column.
      setSortDir(key === "model" ? "asc" : "desc");
    }
  }

  // A plain render helper (not a component) so it doesn't trip
  // react-hooks/static-components; called inline in the header cells.
  const sortIcon = (col: SortKey) =>
    col !== sortKey ? null : sortDir === "asc" ? (
      <ArrowUp className="inline size-3" />
    ) : (
      <ArrowDown className="inline size-3" />
    );

  if (loading) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        Loading usage…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1 text-sm">
        <p>No token usage recorded yet.</p>
        <p>Send a message and usage will appear here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat label="Total tokens" value={formatTokens(totals.total)} />
        <SummaryStat label="Input" value={formatTokens(totals.input)} />
        <SummaryStat label="Output" value={formatTokens(totals.output)} />
        <SummaryStat label="Responses" value={String(totals.responses)} />
      </div>

      {/* Activity heatmap */}
      <Card className="px-4">
        <h2 className="text-sm font-semibold">Activity (last 12 months)</h2>
        <ActivityHeatmap allWeeks={allWeeks} />
        <div className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
          <span>Less</span>
          {LEVEL_BG.map((bg, i) => (
            <div key={i} className={`size-3 rounded-sm ${bg}`} />
          ))}
          <span>More</span>
        </div>
      </Card>

      {/* Per-model table */}
      <Card className="px-4">
        <h2 className="text-sm font-semibold">By model</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left">
                <th
                  className="cursor-pointer py-2 pr-3 font-medium select-none"
                  onClick={() => toggleSort("model")}
                >
                  Model {sortIcon("model")}
                </th>
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 text-right font-medium">Responses</th>
                <th className="py-2 pr-3 text-right font-medium">Input</th>
                <th className="py-2 pr-3 text-right font-medium">Output</th>
                <th className="py-2 pr-3 text-right font-medium">Cache</th>
                <th
                  className="cursor-pointer py-2 pr-3 text-right font-medium select-none"
                  onClick={() => toggleSort("total_tokens")}
                >
                  Total {sortIcon("total_tokens")}
                </th>
                <th
                  className="cursor-pointer py-2 text-right font-medium select-none"
                  onClick={() => toggleSort("last_used")}
                >
                  Last used {sortIcon("last_used")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={`${r.provider}:${r.model}`}
                  className="border-border/50 border-b"
                >
                  <td className="py-2 pr-3 font-mono text-xs">{r.model}</td>
                  <td className="py-2 pr-3">{providerLabel(r.provider)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.responses}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatTokens(r.input_tokens)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatTokens(r.output_tokens)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatTokens(
                      r.cache_creation_tokens + r.cache_read_tokens,
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums">
                    {formatTokens(r.total_tokens)}
                  </td>
                  <td className="text-muted-foreground py-2 text-right text-xs">
                    {r.last_used.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-1 px-4" size="sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </Card>
  );
}

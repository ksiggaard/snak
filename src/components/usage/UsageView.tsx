import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { dailyUsage, usageByModel, type UsageByModel } from "@/lib/db";
import { buildHeatmap, formatTokens, type HeatmapWeek } from "@/lib/usage";
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

/** The token-usage view (T16): a sortable per-model table + activity heatmap. */
export function UsageView() {
  const [rows, setRows] = useState<UsageByModel[]>([]);
  const [weeks, setWeeks] = useState<HeatmapWeek[]>([]);
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
      setWeeks(buildHeatmap(daily, 365).weeks);
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
        <div className="overflow-x-auto pb-1">
          <div className="flex gap-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((cell, di) =>
                  cell === null ? (
                    <div key={di} className="size-3" />
                  ) : (
                    <div
                      key={di}
                      className={`size-3 rounded-sm ${LEVEL_BG[cell.level]}`}
                      title={`${cell.day}: ${formatTokens(cell.total_tokens)} tokens, ${cell.responses} responses`}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
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

"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Validated categorical palette, fixed slot order (see dataviz reference). */
const SERIES_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];
const OVERFLOW_COLOR = "#898781";

export interface PricePointProp {
  t: string;
  prices: number[];
}

export function PriceChart({ series, labels }: { series: PricePointProp[]; labels: string[] }) {
  // Binary markets chart only the first outcome ("chance of Yes") — the
  // complement line adds ink without information. Categorical charts all.
  const shownIdxs = labels.length === 2 ? [0] : labels.map((_, i) => i);
  const data = series.map((p) => {
    const row: Record<string, number> = { t: new Date(p.t).getTime() };
    for (const i of shownIdxs) row[labels[i]!] = Math.round((p.prices[i] ?? 0) * 1000) / 10;
    return row;
  });
  const single = shownIdxs.length === 1;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-slate-600">
        {single ? `Chance of ${labels[0]}` : "Outcome probabilities"}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#e1e0d9" strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) =>
              new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            }
            tick={{ fill: "#898781", fontSize: 12 }}
            axisLine={{ stroke: "#c3c2b7" }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: "#898781", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) => [`${Number(value).toFixed(1)}%`]}
            labelFormatter={(v) =>
              new Date(Number(v)).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            }
            contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e1e0d9" }}
          />
          {!single && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {shownIdxs.map((i) => (
            <Line
              key={i}
              type="stepAfter"
              dataKey={labels[i]!}
              stroke={SERIES_COLORS[i] ?? OVERFLOW_COLOR}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

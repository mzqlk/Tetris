import { FEATURE_NAMES } from '../../ai/features';
import { linearScale, niceTicks, extent } from './scales';
import type { LogEntry } from './types';

const W = 460;
const H = 260;
const M = { top: 12, right: 12, bottom: 28, left: 52 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

const AXIS = '#1a1e3a';
const AXIS_TEXT = '#4488aa';
const BEST = '#00f0ff';
const MEDIAN = '#00ff60';
const WORST = '#ff0040';

/**
 * One colour per feature, tuned for separation on the #0d1220 panel.
 *
 * Chosen with the `dataviz` skill's method rather than by eye: adjacent
 * entries in this array (the order the legend/rows render in) clear the
 * skill's validator on `--mode dark --surface #0d1220` — worst adjacent CVD
 * ΔE 13.0 (target 8.0), worst adjacent normal-vision ΔE 19.3 (floor 15.0),
 * all nine >= 3:1 contrast, all inside the dark lightness band. The
 * originally-drafted neon set (`#00f0ff, #ff6ec7, #f0f000, ...`) failed the
 * lightness band, CVD separation (worst 2.5) and the normal-vision floor
 * (10.5) under the same check, so it was replaced. Nine categorical series
 * is beyond what the skill's own 8-hue reference palette can guarantee
 * (it only clears all-pairs separation up to 3 slots), so this only holds
 * for *adjacent* pairs -- true here because every chart shows the features
 * in this fixed order with a direct text label beside each mark, which is
 * exactly the "stacks/bars/lines" case the skill scopes the adjacent check to.
 */
export const SERIES_COLORS = [
  '#d95926', '#0070b1', '#199e70', '#3987e5', '#c98500',
  '#d55181', '#008300', '#9085e9', '#e66767',
];

/** Sequential ramp for the sigma heatmap: near-background at 0, hot cyan at 1. */
export function sigmaColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const stops: [number, number, number][] = [
    [13, 18, 32], [0, 60, 90], [0, 150, 170], [0, 240, 255],
  ];
  const pos = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const [r0, g0, b0] = stops[i];
  const [r1, g1, b1] = stops[i + 1];
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `rgb(${mix(r0, r1)}, ${mix(g0, g1)}, ${mix(b0, b1)})`;
}

const fmt = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k`
  : Math.abs(v) >= 10 ? v.toFixed(0)
  : v.toFixed(2);

// Generation numbers are counts, not fractional weight values — `fmt` alone
// renders a 7-generation log's x-axis as "0.00 · 2.00 · 4.00 · 6.00". The
// y-axis legitimately shows fractional weights/fitness, so it keeps `fmt`.
const fmtInt = (v: number) => Math.round(v).toString();

function Axes({ xTicks, yTicks, x, y, xFmt = fmt }: {
  xTicks: number[];
  yTicks: number[];
  x: (v: number) => number;
  y: (v: number) => number;
  xFmt?: (v: number) => string;
}) {
  return (
    <g>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.left} x2={M.left + PLOT_W} y1={y(t)} y2={y(t)} stroke={AXIS} />
          <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill={AXIS_TEXT}>
            {fmt(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={x(t)} y={H - 8} textAnchor="middle" fontSize="10" fill={AXIS_TEXT}>
          {xFmt(t)}
        </text>
      ))}
    </g>
  );
}

const path = (points: [number, number][]) =>
  points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');

export function FitnessChart({ entries }: { entries: LogEntry[] }) {
  const [g0, g1] = extent(entries.map((e) => e.gen));
  const [, yMax] = extent(entries.map((e) => e.best));
  const x = linearScale(g0, g1, M.left, M.left + PLOT_W);
  const y = linearScale(0, yMax, M.top + PLOT_H, M.top);

  const band = [
    ...entries.map((e): [number, number] => [x(e.gen), y(e.best)]),
    ...entries.slice().reverse().map((e): [number, number] => [x(e.gen), y(e.worst)]),
  ];

  return (
    <svg width={W} height={H} role="img" aria-label="Fitness per generation">
      <Axes x={x} y={y} xTicks={niceTicks(g0, g1, 5)} yTicks={niceTicks(0, yMax, 5)} xFmt={fmtInt} />
      <path d={`${path(band)} Z`} fill={BEST} fillOpacity={0.1} stroke="none" />
      <path d={path(entries.map((e) => [x(e.gen), y(e.worst)]))} fill="none" stroke={WORST} strokeWidth={1} opacity={0.7} />
      <path d={path(entries.map((e) => [x(e.gen), y(e.median)]))} fill="none" stroke={MEDIAN} strokeWidth={1.5} />
      <path d={path(entries.map((e) => [x(e.gen), y(e.best)]))} fill="none" stroke={BEST} strokeWidth={2} />
      <g fontSize="10">
        {([['best', BEST], ['median', MEDIAN], ['worst', WORST]] as const).map(([label, color], i) => (
          <text key={label} x={M.left + 6 + i * 58} y={M.top + 12} fill={color}>{label}</text>
        ))}
      </g>
    </svg>
  );
}

export function WeightEvolutionChart({ entries }: { entries: LogEntry[] }) {
  const [g0, g1] = extent(entries.map((e) => e.gen));
  const [lo, hi] = extent(entries.flatMap((e) => e.mu));
  const bound = Math.max(Math.abs(lo), Math.abs(hi), 0.1);
  const x = linearScale(g0, g1, M.left, M.left + PLOT_W);
  const y = linearScale(-bound, bound, M.top + PLOT_H, M.top);

  return (
    <svg width={W} height={H} role="img" aria-label="Weight evolution">
      <Axes x={x} y={y} xTicks={niceTicks(g0, g1, 5)} yTicks={niceTicks(-bound, bound, 5)} xFmt={fmtInt} />
      <line x1={M.left} x2={M.left + PLOT_W} y1={y(0)} y2={y(0)} stroke={AXIS_TEXT} strokeDasharray="2 3" />
      {FEATURE_NAMES.map((name, d) => (
        <path
          key={name}
          d={path(entries.map((e) => [x(e.gen), y(e.mu[d])]))}
          fill="none"
          stroke={SERIES_COLORS[d]}
          strokeWidth={1.5}
        >
          <title>{name}</title>
        </path>
      ))}
      <g fontSize="9">
        {FEATURE_NAMES.map((name, d) => (
          <text key={name} x={M.left + 4} y={M.top + 10 + d * 11} fill={SERIES_COLORS[d]}>{name}</text>
        ))}
      </g>
    </svg>
  );
}

export function SigmaHeatmap({ entries }: { entries: LogEntry[] }) {
  const [, sMax] = extent(entries.flatMap((e) => e.sigma));

  // POSITION uses the unfloored width so the last cell always lands on the right
  // edge, however many generations there are. WIDTH is floored to 1px so a cell
  // never becomes invisible. Flooring the position instead — `Math.max(1, ...)`
  // for both — walks the newest cells off the canvas once entries.length exceeds
  // PLOT_W (396), where the browser's default overflow:hidden silently clips
  // them. That hides precisely the freshest data during a long run, while the
  // corner label keeps reporting the correct latest generation.
  const cellW = PLOT_W / entries.length;
  const cellH = PLOT_H / FEATURE_NAMES.length;

  return (
    <svg width={W} height={H} role="img" aria-label="Sigma contraction heatmap">
      {entries.map((entry, gi) =>
        entry.sigma.map((s, d) => (
          <rect
            key={`${entry.gen}-${d}`}
            x={M.left + gi * cellW}
            y={M.top + d * cellH}
            width={Math.max(1, Math.ceil(cellW))}
            height={Math.ceil(cellH)}
            fill={sigmaColor(sMax === 0 ? 0 : s / sMax)}
          >
            <title>{`gen ${entry.gen} · ${FEATURE_NAMES[d]} · sigma ${s.toFixed(3)}`}</title>
          </rect>
        )),
      )}
      {FEATURE_NAMES.map((name, d) => (
        <text key={name} x={M.left - 6} y={M.top + d * cellH + cellH / 2 + 3}
              textAnchor="end" fontSize="8" fill={AXIS_TEXT}>
          {name.slice(0, 9)}
        </text>
      ))}
      <text x={M.left} y={H - 8} fontSize="10" fill={AXIS_TEXT}>gen {entries[0].gen}</text>
      <text x={M.left + PLOT_W} y={H - 8} textAnchor="end" fontSize="10" fill={AXIS_TEXT}>
        gen {entries[entries.length - 1].gen} · max sigma {sMax.toFixed(2)}
      </text>
    </svg>
  );
}

export function BestWeightsChart({ entry }: { entry: LogEntry }) {
  const bound = Math.max(...entry.bestWeights.map(Math.abs), 0.1);
  const x = linearScale(-bound, bound, M.left, M.left + PLOT_W);
  const barH = PLOT_H / FEATURE_NAMES.length;

  return (
    <svg width={W} height={H} role="img" aria-label="Best weights">
      <line x1={x(0)} x2={x(0)} y1={M.top} y2={M.top + PLOT_H} stroke={AXIS} />
      {FEATURE_NAMES.map((name, d) => {
        const value = entry.bestWeights[d];
        const left = Math.min(x(0), x(value));
        return (
          <g key={name}>
            <rect
              x={left}
              y={M.top + d * barH + 2}
              width={Math.abs(x(value) - x(0))}
              height={barH - 4}
              fill={SERIES_COLORS[d]}
              fillOpacity={0.75}
            />
            <text x={M.left - 6} y={M.top + d * barH + barH / 2 + 3}
                  textAnchor="end" fontSize="8" fill={AXIS_TEXT}>
              {name.slice(0, 9)}
            </text>
            <text x={value >= 0 ? x(value) + 4 : x(value) - 4}
                  y={M.top + d * barH + barH / 2 + 3}
                  textAnchor={value >= 0 ? 'start' : 'end'} fontSize="8" fill={AXIS_TEXT}>
              {value.toFixed(2)}
            </text>
          </g>
        );
      })}
      <text x={M.left} y={H - 8} fontSize="10" fill={AXIS_TEXT}>
        gen {entry.gen} · {Math.round(entry.best).toLocaleString()} lines
      </text>
    </svg>
  );
}

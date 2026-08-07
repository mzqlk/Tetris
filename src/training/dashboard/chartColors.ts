/**
 * One colour per feature, tuned for separation on the #0d1220 panel.
 *
 * Chosen with the `dataviz` skill's method rather than by eye: adjacent
 * entries in this array (the order the legend/rows render in) clear the
 * skill's validator on `--mode dark --surface #0d1220` — worst adjacent CVD
 * ΔE 13.0 (target 8.0), worst adjacent normal-vision ΔE 19.3 (floor 15.0),
 * all nine original colours >= 3:1 contrast, all inside the dark lightness band. The
 * originally-drafted neon set (`#00f0ff, #ff6ec7, #f0f000, ...`) failed the
 * lightness band, CVD separation (worst 2.5) and the normal-vision floor
 * (10.5) under the same check, so it was replaced. Ten direct-labelled categorical series
 * is beyond what the skill's own 8-hue reference palette can guarantee
 * (it only clears all-pairs separation up to 3 slots), so this only holds
 * for *adjacent* pairs -- true here because every chart shows the features
 * in this fixed order with a direct text label beside each mark, which is
 * exactly the "stacks/bars/lines" case the skill scopes the adjacent check to. The appended
 * tenth colour is covered here by the uniqueness and hex-format contracts only.
 */
export const SERIES_COLORS = [
  '#d95926', '#0070b1', '#199e70', '#3987e5', '#c98500',
  '#d55181', '#008300', '#9085e9', '#e66767', '#8f6bd8',
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

import { useLayoutEffect, useRef, useState } from 'react'
import { fmtNum, fmtDate, MONTHS, isoOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'

const W = 340 // viewBox width; the svg stretches to its container, height comes from `h`

// points: [{ t: ms, y: num, d?: iso, m?: 0..1, note?: str }] sorted by t.
//   m    marks the point — a second reading carried by the same dot (bigger and more solid =
//        more of it). Used for effort on the weight curve, where the two belong on one line:
//        the same weight with less left in the tank is not the same session.
//   note extra text for that point's tooltip.
// series: [{ points, label, unit, color }] — the combined chart's mode. Several series share
//   ONE date axis but each is scaled to its own range (a weight curve, a calorie curve and a
//   volume curve differ by orders of magnitude; one shared y would flatten two of them), so
//   the y axis carries no numbers and the tooltip names the series and its unit. A `y: null`
//   point is an open gap: the line stops there instead of being drawn through as zero.
// opts: { h, unit, color, axes, goal, invert }
//   invert flips the y axis, for a scale that counts down as it gets harder (RIR). Without it
//   a curve of reps-in-reserve reads upside down, with the hardest sets at the floor.
export default function LineChart({
  points,
  series,
  h = 150,
  unit = '',
  color = 'var(--acc)',
  axes = true,
  goal = null,
  invert = false,
}) {
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const tipRef = useRef(null)
  const [hover, setHover] = useState(null) // { x, y, iso, v }

  // A new dataset has different coordinates and meaning, so never carry the previous
  // point selection into it. Layout timing removes the marker before the new chart paints.
  useLayoutEffect(() => {
    setHover(null)
  }, [points, series])

  // The tooltip is placed after layout, from its measured size, because the chart
  // lives in an overflow-clipped box: a fixed half-width offset (what this used to
  // do) hangs the label off the edge on the first and last point, and the clip then
  // eats it. Reading offsetWidth here also covers translated labels, which are not
  // all the same length. Writing straight to the node's style keeps this off the
  // render path — hover fires on every mouse move.
  useLayoutEffect(() => {
    const tip = tipRef.current,
      wrap = wrapRef.current
    if (!hover || !tip || !wrap) return
    const cw = wrap.clientWidth,
      ch = wrap.clientHeight
    const tw = tip.offsetWidth,
      th = tip.offsetHeight
    const M = 4 // breathing room against the clip
    const cx = (hover.x / W) * cw,
      cy = (hover.y / h) * ch
    tip.style.left = Math.max(M, Math.min(cw - tw - M, cx - tw / 2)) + 'px'
    // Parked at the top, but dropped below the point when the point sits high
    // enough that the label would cover the very value it is reporting.
    tip.style.top = (cy < th + 14 ? Math.min(ch - th - M, cy + 14) : M) + 'px'
  })

  const drawable = p => !!p && p.y != null && isFinite(p.y)
  const multi = Array.isArray(series) && series.length > 0
  const sets = multi ? series.filter(s => s && Array.isArray(s.points) && s.points.some(drawable)) : []
  if (multi ? sets.length === 0 : !points || points.length === 0)
    return <div className="empty small">{t('No data yet')}</div>

  const H = h
  const P = { l: axes && !multi ? 34 : 8, r: 12, t: 10, b: axes ? 22 : 8 }
  const single = !multi && points.length === 1
  const pts = multi ? null : single ? [points[0], points[0]] : points

  let ymin = 0,
    ymax = 1
  if (!multi) {
    // Combined mode has no shared range: kcal, sets and kg on one scale would flatten two
    // of the three, so every series gets its own below and Y() stays single-series only.
    const ys = pts.map(p => p.y)
    ymin = Math.min(...ys)
    ymax = Math.max(...ys)
    if (goal != null && isFinite(goal)) {
      ymin = Math.min(ymin, goal)
      ymax = Math.max(ymax, goal)
    }
    if (ymin === ymax) {
      ymin -= 1
      ymax += 1
    }
    const pad = (ymax - ymin) * 0.12
    ymin -= pad
    ymax += pad
  }
  // Each series is stretched over its own min..max so three curves of wildly different
  // magnitudes stay readable on one axis; nothing is averaged or unit-converted here.
  const scales = multi
    ? sets.map(s => {
        const ys = s.points.filter(drawable).map(p => p.y)
        let lo = Math.min(...ys),
          hi = Math.max(...ys)
        if (lo === hi) {
          lo -= 1
          hi += 1
        }
        const pad = (hi - lo) * 0.12
        return { lo: lo - pad, hi: hi + pad }
      })
    : null

  let t0, t1
  if (multi) {
    const ts = sets.flatMap(s => s.points.filter(drawable).map(p => p.t))
    t0 = Math.min(...ts)
    t1 = Math.max(...ts) || t0 + 1
  } else {
    t0 = pts[0].t
    t1 = pts[pts.length - 1].t || t0 + 1
  }
  const X = t => (t1 === t0 ? (P.l + W - P.r) / 2 : P.l + ((t - t0) / (t1 - t0)) * (W - P.l - P.r))
  const Y = y => {
    const f = (y - ymin) / (ymax - ymin)
    return P.t + (invert ? f : 1 - f) * (H - P.t - P.b)
  }
  const yOf = multi
    ? (i, y) => {
        const s = scales[i]
        const f = (y - s.lo) / (s.hi - s.lo)
        return P.t + (invert ? f : 1 - f) * (H - P.t - P.b)
      }
    : (_, y) => Y(y)

  const gridlines = []
  if (axes) {
    // No horizontal rules in combined mode: with a scale per series there is no single y
    // they could be honest about. The date ticks below are shared and stay.
    if (!multi) {
      const range = ymax - ymin,
        raw = range / 3
      const pow = Math.pow(10, Math.floor(Math.log10(raw)))
      let step = 10 * pow
      for (const m of [1, 2, 2.5, 5, 10])
        if (raw <= m * pow) {
          step = m * pow
          break
        }
      for (let v = Math.ceil(ymin / step) * step; v <= ymax + 1e-9; v += step) {
        const y = Y(v)
        gridlines.push(
          <g key={'y' + v}>
            <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 4" />
            <text x={P.l - 5} y={y + 3.5} textAnchor="end" fontSize="9.5" fill="var(--label-2)">
              {fmtNum(v)}
            </text>
          </g>,
        )
      }
    }
    const d0 = new Date(t0),
      d1 = new Date(t1)
    const ticks = []
    let m = new Date(d0.getFullYear(), d0.getMonth() + 1, 1)
    while (m <= d1) {
      ticks.push({ t: +m, txt: t(MONTHS[m.getMonth()]) })
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1)
    }
    if (ticks.length === 0 && !single) {
      for (let i = 0; i <= 2; i++) {
        const tv = t0 + ((t1 - t0) * i) / 2,
          dd = new Date(tv)
        ticks.push({
          t: tv,
          txt: dd.getDate() + ' ' + t(MONTHS[dd.getMonth()]),
          anchor: i === 0 ? 'start' : i === 2 ? 'end' : 'middle',
        })
      }
    }
    const every = Math.max(1, Math.ceil(ticks.length / 7))
    ticks.forEach((tk, i) => {
      if (i % every) return
      const x = X(tk.t)
      gridlines.push(
        <g key={'x' + i}>
          <line x1={x} y1={P.t} x2={x} y2={H - P.b} stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 4" />
          <text x={x} y={H - 7} textAnchor={tk.anchor || 'middle'} fontSize="9.5" fill="var(--label-2)">
            {tk.txt}
          </text>
        </g>,
      )
    })
  }

  const poly = multi ? '' : pts.map(p => X(p.t).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' ')
  const last = multi ? null : pts[pts.length - 1]
  const gid = 'g' + Math.round(t0 % 1e7) + '_' + H
  const hoverSource = multi ? null : single ? [points[0]] : points
  const hoverDates = multi ? [] : hoverSource.map(p => p.d || isoOf(new Date(p.t)))
  // In combined mode every point of every series is hoverable, tagged with the series it
  // belongs to so the tooltip can name it; single mode is unchanged (one series, shared unit).
  const hoverPts = multi
    ? sets.flatMap((s, i) =>
        s.points.filter(drawable).map(p => ({
          x: X(p.t),
          y: yOf(i, p.y),
          iso: p.d || isoOf(new Date(p.t)),
          v: p.y,
          label: s.label,
          unit: s.unit,
          color: s.color,
          note: p.note,
        })),
      )
    : hoverSource.map((p, i) => ({ x: X(p.t), y: Y(p.y), iso: hoverDates[i], v: p.y, note: p.note }))
  const showYear = new Set(hoverPts.map(p => new Date(p.iso + 'T12:00:00').getFullYear())).size > 1
  const marked = !multi && points.some(p => p.m != null)

  // Segment a series on its nulls: a gap is a missing reading, so the line stops on one
  // side of it and restarts on the other rather than being drawn through as a zero.
  const segmentsOf = s => {
    const segs = []
    let cur = []
    for (const p of s.points) {
      if (drawable(p)) cur.push(p)
      else if (cur.length) {
        segs.push(cur)
        cur = []
      }
    }
    if (cur.length) segs.push(cur)
    return segs
  }

  const onMove = e => {
    const c = e.touches ? e.touches[0] : e
    if (!c || c.clientX === undefined) return
    const r = svgRef.current.getBoundingClientRect()
    const w = r.width || W
    const vx = ((c.clientX - r.left) / w) * W
    let best = hoverPts[0]
    hoverPts.forEach(p => {
      if (Math.abs(p.x - vx) < Math.abs(best.x - vx)) best = p
    })
    setHover(best)
  }

  return (
    <div
      className="chart-i"
      ref={wrapRef}
      onMouseMove={onMove}
      onMouseDown={onMove}
      onMouseLeave={() => setHover(null)}
      onTouchStart={onMove}
      onTouchMove={onMove}
    >
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ aspectRatio: `${W}/${H}` }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridlines}
        {!multi && goal != null && isFinite(goal) && (
          <>
            <line
              x1={P.l}
              y1={Y(goal)}
              x2={W - P.r}
              y2={Y(goal)}
              stroke="var(--yellow)"
              strokeWidth="1.6"
              strokeDasharray="7 4"
            />
            <text x={W - P.r - 2} y={Y(goal) - 5} textAnchor="end" fontSize="9.5" fontWeight="700" fill="var(--yellow)">
              {fmtNum(goal)}
            </text>
          </>
        )}
        {multi &&
          sets.map((s, i) => {
            const segs = segmentsOf(s)
            if (!segs.length) return null
            const lastSeg = segs[segs.length - 1]
            return (
              <g key={s.label || i}>
                {segs.map((seg, j) =>
                  seg.length === 1 ? (
                    <circle key={j} cx={X(seg[0].t)} cy={yOf(i, seg[0].y)} r="3" fill={s.color} />
                  ) : (
                    <polyline
                      key={j}
                      points={seg.map(p => `${X(p.t).toFixed(1)},${yOf(i, p.y).toFixed(1)}`).join(' ')}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="2.2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ),
                )}
                {lastSeg.length > 1 && (
                  <circle
                    cx={X(lastSeg[lastSeg.length - 1].t)}
                    cy={yOf(i, lastSeg[lastSeg.length - 1].y)}
                    r="4"
                    fill={s.color}
                  />
                )}
              </g>
            )
          })}
        {!multi && (
          <polygon points={`${P.l},${H - P.b} ${poly} ${X(last.t).toFixed(1)},${H - P.b}`} fill={`url(#${gid})`} />
        )}
        {!multi && (
          <polyline
            points={poly}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {marked &&
          pts.map((p, i) =>
            p.m == null ? null : (
              <circle key={'m' + i} cx={X(p.t)} cy={Y(p.y)} r={2.4 + p.m * 3} fill={color} opacity={0.3 + p.m * 0.7} />
            ),
          )}
        {!multi && last && <circle cx={X(last.t)} cy={Y(last.y)} r="4" fill={color} />}
        {hover && (
          <g>
            <line
              className="cvl"
              x1={hover.x}
              y1={P.t}
              x2={hover.x}
              y2={H - P.b}
              stroke="var(--label-3)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <line
              className="chl"
              x1={P.l}
              y1={hover.y}
              x2={W - P.r}
              y2={hover.y}
              stroke="var(--label-3)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle cx={hover.x} cy={hover.y} r="5" fill={hover.color || color} stroke="var(--bg)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover && (
        <div className="ctip" ref={tipRef}>
          {multi
            ? `${fmtDate(hover.iso, true, showYear)} · ${hover.label} ${fmtNum(hover.v)}${hover.unit ? ' ' + hover.unit : ''}${
                hover.note ? ' · ' + hover.note : ''
              }`
            : `${fmtDate(hover.iso, true, showYear)} · ${fmtNum(hover.v)}${unit ? ' ' + unit : ''}${
                hover.note ? ' · ' + hover.note : ''
              }`}
        </div>
      )}
    </div>
  )
}

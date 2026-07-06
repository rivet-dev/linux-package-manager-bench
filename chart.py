#!/usr/bin/env python3
"""Render results/data.json (written by synthesize.js) into chart.png:
a horizontal stacked bar of each manager's OFFLINE INSTALL time, broken down
by phase (download excluded). When one manager dwarfs the rest, a broken x-axis
keeps the small managers legible while still showing the outlier's true length."""
import json
import os
import sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "results", "data.json")

PHASES = ["startup", "resolve", "verify", "unpack", "configure", "link"]
SEGMENTS = PHASES + ["unknown", "overhead"]
# Validated 6-slot categorical palette (dataviz skill) + grays for unknown/overhead.
COLORS = {
    "startup": "#2a78d6", "resolve": "#1baf7a", "verify": "#eda100",
    "unpack": "#008300", "configure": "#4a3aa7", "link": "#e34948",
    "unknown": "#8a8f98", "overhead": "#c3c2b7",
}


def seg_val(m, s):
    if s == "overhead":  # unclassified line-delta + exec overhead, so bars = install_s
        return max(0.0, m["install_s"] - sum(m["buckets"].values()))
    return m["buckets"].get(s, 0.0)


def draw(ax, mgrs):
    for i, m in enumerate(mgrs):
        left = 0.0
        for s in SEGMENTS:
            v = seg_val(m, s)
            if v <= 0:
                continue
            ax.barh(i, v, left=left, height=0.62, color=COLORS[s],
                    edgecolor="#fcfcfb", linewidth=1.2)
            left += v
    ax.set_facecolor("#fcfcfb")
    ax.set_axisbelow(True)
    ax.grid(axis="x", color="#e1e0d9", linewidth=0.8)


def main():
    if not os.path.exists(DATA):
        sys.exit(f"chart.py: {DATA} not found — run `node run.js` (or synthesize.js) first")
    mgrs = json.load(open(DATA)).get("managers", [])
    if not mgrs:
        sys.exit("chart.py: no managers in data.json")
    mgrs.sort(key=lambda m: m["install_s"])  # ascending
    names = [m["manager"] for m in mgrs]
    totals = [m["install_s"] for m in mgrs]
    lows = [m.get("install_min", t) for m, t in zip(mgrs, totals)]
    highs = [m.get("install_max", t) for m, t in zip(mgrs, totals)]

    def whisker(ax, i):
        lo, hi = lows[i], highs[i]
        if hi > lo:
            ax.plot([lo, hi], [i, i], color="#0b0b0b", lw=1.1, zorder=6)
            for x in (lo, hi):
                ax.plot([x, x], [i - 0.11, i + 0.11], color="#0b0b0b", lw=1.1, zorder=6)

    top = max(totals)
    oi = totals.index(top)  # outlier row
    others = max([t for j, t in enumerate(totals) if j != oi], default=0.0)
    non_out_hi = max([highs[j] for j in range(len(totals)) if j != oi], default=top)
    broken = top > 4 * others and top > 5 and others > 0
    h = 1.6 + 0.5 * len(mgrs)

    plt.rcParams["font.family"] = "sans-serif"
    if broken:
        left_max = round(non_out_hi * 1.10 + 0.05, 2)
        fig, (axl, axr) = plt.subplots(
            1, 2, sharey=True, figsize=(9.2, h), dpi=150,
            gridspec_kw={"width_ratios": [4, 1.15], "wspace": 0.06})
        draw(axl, mgrs); draw(axr, mgrs)
        axl.set_xlim(0, left_max)
        axr.set_xlim(lows[oi] * 0.985, highs[oi] * 1.02)
        axr.set_xticks([round(top, 2)])
        axl.spines[["right", "top"]].set_visible(False)
        axr.spines[["left", "top"]].set_visible(False)
        axr.tick_params(left=False)
        d = 0.015
        for ax, at in ((axl, 1.0), (axr, 0.0)):
            ax.spines["bottom"].set_color("#c3c2b7")
            kw = dict(transform=ax.transAxes, color="#898781", lw=1, clip_on=False)
            ax.plot((at - d, at + d), (-d, +d), **kw)
            ax.plot((at - d, at + d), (1 - d, 1 + d), **kw)
        axl.set_yticks(range(len(names))); axl.set_yticklabels(names, fontsize=11)
        axl.set_xlabel("install time (s)", fontsize=9, color="#52514e")
        for i, t in enumerate(totals):
            ax = axr if i == oi else axl
            whisker(ax, i)
            ax.text(highs[i] + (top * 0.006 if ax is axr else left_max * 0.02), i,
                    f"{t:.2f}s", va="center", fontsize=9.5, fontweight="bold", color="#0b0b0b")
    else:
        fig, ax = plt.subplots(figsize=(9.2, h), dpi=150)
        draw(ax, mgrs)
        ax.set_xlim(0, max(highs) * 1.12)
        ax.spines[["right", "top"]].set_visible(False)
        ax.spines["bottom"].set_color("#c3c2b7")
        ax.set_yticks(range(len(names))); ax.set_yticklabels(names, fontsize=11)
        ax.set_xlabel("install time (s)", fontsize=9, color="#52514e")
        for i, t in enumerate(totals):
            whisker(ax, i)
            ax.text(highs[i] + top * 0.012, i, f"{t:.2f}s", va="center", fontsize=9.5,
                    fontweight="bold", color="#0b0b0b")

    fig.patch.set_facecolor("#fcfcfb")
    handles = [plt.Rectangle((0, 0), 1, 1, color=COLORS[s]) for s in SEGMENTS]
    fig.legend(handles, SEGMENTS, ncol=len(SEGMENTS), loc="upper center",
               bbox_to_anchor=(0.5, 0.94), frameon=False, fontsize=8.5, handlelength=1.1)
    reps = mgrs[0].get("reps", "?")
    fig.suptitle(f"git install time by phase  ·  offline, download excluded  ·  bar = median of {reps} runs, whisker = min–max",
                 x=0.02, ha="left", y=0.99, fontsize=11, fontweight="bold", color="#0b0b0b")
    fig.subplots_adjust(top=0.82, bottom=0.16, left=0.10, right=0.93)
    fig.savefig(os.path.join(ROOT, "chart.png"), facecolor="#fcfcfb")
    print("wrote chart.png")


if __name__ == "__main__":
    main()

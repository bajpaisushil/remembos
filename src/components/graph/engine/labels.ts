/**
 * Greedy, collision-aware label placement for the graph canvas.
 *
 * Candidates arrive with a priority (selection > hover > neighbourhood > big nodes); each is placed
 * under its node unless it would overlap a label that is already placed, then above it as a second
 * choice. Everything is in screen (CSS px) space so labels stay the same size at any zoom.
 */

export interface LabelCandidate {
  /** Node index. */
  index: number;
  /** Higher goes first. */
  priority: number;
  /** Node centre and radius on screen. */
  x: number;
  y: number;
  r: number;
  /** Label box size (text width + padding, line height + padding). */
  width: number;
  height: number;
  /** Placed even when it overlaps (selected / hovered node). */
  force?: boolean;
}

export interface PlacedLabel {
  index: number;
  /** Top-left corner of the label box. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP = 3;

/**
 * Place up to `max` labels inside a `width` × `height` screen. `out` is reused to avoid allocations.
 */
export function placeLabels(
  candidates: LabelCandidate[],
  width: number,
  height: number,
  max: number,
  out: PlacedLabel[] = [],
): PlacedLabel[] {
  out.length = 0;
  candidates.sort((a, b) => b.priority - a.priority);
  for (const c of candidates) {
    if (out.length >= max) break;
    const left = c.x - c.width / 2;
    const below = c.y + c.r + GAP;
    const above = c.y - c.r - GAP - c.height;
    let top = below;
    if (!c.force) {
      if (left + c.width < 0 || left > width) continue;
      if (collides(out, left, below, c.width, c.height) || below + c.height > height) {
        if (above >= 0 && !collides(out, left, above, c.width, c.height)) top = above;
        else continue;
      }
      if (top > height || top + c.height < 0) continue;
    }
    out.push({ index: c.index, x: left, y: top, width: c.width, height: c.height });
  }
  return out;
}

function collides(placed: PlacedLabel[], x: number, y: number, w: number, h: number): boolean {
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (x < p.x + p.width + GAP && x + w + GAP > p.x && y < p.y + p.height + 1 && y + h + 1 > p.y) return true;
  }
  return false;
}

"use client";
/**
 * The knowledge graph screen: memories and the people, numbers, links, dates, topics and tags they
 * mention, drawn as an interactive force-directed map.
 *
 * Reads `?focus=<node id>` to show one node's neighbourhood (linkable from anywhere, e.g. an item
 * page). Filters: entity types (instant, client-side), "Only shared" and "Similar memories"
 * (rebuild through buildGraph). The graph rebuilds by itself when memories are added, edited,
 * finish processing or are removed.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { isTypingTarget } from "@/components/ui/internal";
import { ROUTES } from "@/lib/config";
import { db } from "@/lib/db";
import { useSettings } from "@/lib/settings";
import type { EntityType, GraphNode } from "@/lib/types";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import { GraphDetails } from "./GraphDetails";
import { GraphFocusBanner, GraphLegend, GraphUpdatingPill, GraphZoomControls } from "./GraphOverlays";
import {
  GraphEmptyLibrary,
  GraphError,
  GraphStageLoading,
  GraphStillReading,
  NoConnectionsMessage,
  StageBackdrop,
  StageCard,
  StageMessage,
} from "./GraphStates";
import { GraphToolbar } from "./GraphToolbar";
import { countGraph, filterGraph, plural, presentKinds } from "./graph-utils";
import { displayLabel } from "./engine/model";
import { useGraphData } from "./useGraphData";

const NO_HIDDEN: ReadonlySet<EntityType> = new Set();
const PAN_STEP = 80;

export function GraphScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const focusId = params.get("focus") || undefined;

  const [sharedOnly, setSharedOnly] = useState(false);
  const [similar, setSimilar] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<EntityType>>(NO_HIDDEN);
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);

  // Opening a focus link selects that node.
  const [prevFocus, setPrevFocus] = useState(focusId);
  if (prevFocus !== focusId) {
    setPrevFocus(focusId);
    if (focusId) setSelectedId(focusId);
  }

  const { stats, data, building, error, retry } = useGraphData({ sharedOnly, similar, focusId });
  const visible = useMemo(() => (data ? filterGraph(data, hidden) : null), [data, hidden]);
  const counts = useMemo(() => (data ? countGraph(data) : null), [data]);
  const visibleCounts = useMemo(() => (visible ? countGraph(visible) : null), [visible]);
  const nodeById = useMemo(() => new Map((visible?.nodes ?? []).map((n) => [n.id, n] as const)), [visible]);

  const canvasRef = useRef<GraphCanvasHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const [insets, setInsets] = useState({ right: 0, bottom: 0 });
  const [messageEl, setMessageEl] = useState<HTMLElement | null>(null);
  const [messageInset, setMessageInset] = useState(0);
  const instructionsId = useId();

  // Measure how much of the canvas the details panel covers, so the camera aims at the rest.
  useEffect(() => {
    const stage = stageRef.current;
    if (!panelEl || !stage) return;
    const ro = new ResizeObserver(() => {
      const s = stage.getBoundingClientRect();
      const p = panelEl.getBoundingClientRect();
      const drawer = p.width < s.width * 0.75;
      setInsets(drawer ? { right: Math.max(0, s.right - p.left), bottom: 0 } : { right: 0, bottom: Math.max(0, s.bottom - p.top) });
    });
    ro.observe(panelEl);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [panelEl]);

  // A message card at the bottom of the canvas: frame the dots above it.
  useEffect(() => {
    const stage = stageRef.current;
    if (!messageEl || !stage) return;
    const ro = new ResizeObserver(() => {
      setMessageInset(Math.max(0, stage.getBoundingClientRect().bottom - messageEl.getBoundingClientRect().top + 8));
    });
    ro.observe(messageEl);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [messageEl]);

  const select = useCallback((id: string | null) => setSelectedId(id), []);
  const locate = useCallback((id: string) => {
    setSelectedId(id);
    canvasRef.current?.focusNode(id);
  }, []);
  const pick = useCallback((node: GraphNode) => locate(node.id), [locate]);
  const focusMode = useCallback(
    (id: string) => router.push(`${ROUTES.graph}?focus=${encodeURIComponent(id)}`, { scroll: false }),
    [router],
  );
  const showAll = useCallback(() => router.push(ROUTES.graph, { scroll: false }), [router]);
  const toggleType = useCallback((t: EntityType) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  // Keyboard: + / − zoom, 0 fit, Esc deselect, arrows pan (when the graph has focus).
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    const c = canvasRef.current;
    if (!c) return;
    const onCanvas = e.target instanceof HTMLElement && e.target.dataset.testid === "graph-canvas";
    switch (e.key) {
      case "+":
      case "=":
        c.zoomIn();
        break;
      case "-":
      case "_":
        c.zoomOut();
        break;
      case "0":
        c.fit();
        break;
      case "Escape":
        if (!selectedId) return;
        setSelectedId(null);
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        if (!onCanvas) return;
        c.panBy(
          e.key === "ArrowLeft" ? PAN_STEP : e.key === "ArrowRight" ? -PAN_STEP : 0,
          e.key === "ArrowUp" ? PAN_STEP : e.key === "ArrowDown" ? -PAN_STEP : 0,
        );
        break;
      default:
        return;
    }
    e.preventDefault();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ---- States without a graph ----
  if (!stats) return <GraphStageLoading />;
  if (stats.total === 0) return <GraphEmptyLibrary />;
  if (stats.ready === 0) return <GraphStillReading processing={stats.processing} />;
  if (!visible || !data) return error ? <GraphError onRetry={retry} /> : <GraphStageLoading />;

  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;
  const selectedLabel = selectedNode ? displayLabel(selectedNode.kind, selectedNode.label, selectedNode.entityType) : null;
  const selectedDegree = selectedId ? visible.links.reduce((n, l) => n + (l.source === selectedId || l.target === selectedId ? 1 : 0), 0) : 0;
  const focusNode = focusId ? nodeById.get(focusId) : undefined;
  const focusLabel = focusNode ? displayLabel(focusNode.kind, focusNode.label, focusNode.entityType) : "this";
  const panelOpen = !!selectedId;
  const vc = visibleCounts!;
  const filtersActive = hidden.size > 0;

  let message: ReactNode = null;
  if (focusId && !visible.nodes.length) {
    message = (
      <StageMessage
        testId="graph-focus-missing"
        title="Not in the graph"
        description="That memory or connection isn't here anymore — it may have been removed or changed."
        action={
          <Button size="sm" onClick={showAll}>
            Show everything
          </Button>
        }
      />
    );
  } else if (!visible.links.length && !building) {
    if (data.links.length && filtersActive) {
      message = (
        <StageMessage
          testId="graph-filtered-out"
          title="Nothing to connect with these filters"
          description="Every kind of connection in this view is hidden."
          action={
            <Button size="sm" onClick={() => setHidden(NO_HIDDEN)}>
              Show all kinds
            </Button>
          }
        />
      );
    } else if (sharedOnly) {
      message = (
        <StageMessage
          testId="graph-nothing-shared"
          title="Nothing shared yet"
          description="No name, number, link or tag appears in two memories yet."
          action={
            <Button size="sm" variant="secondary" onClick={() => setSharedOnly(false)}>
              Show everything they mention
            </Button>
          }
        />
      );
    } else if (!focusId) {
      message = <NoConnectionsMessage />;
    }
  }

  return (
    <StageCard>
      <GraphToolbar
        nodes={visible.nodes}
        counts={counts}
        visibleCounts={visibleCounts}
        hidden={hidden}
        onToggleType={toggleType}
        onShowAllTypes={() => setHidden(NO_HIDDEN)}
        sharedOnly={sharedOnly}
        onSharedOnlyChange={setSharedOnly}
        similar={similar}
        onSimilarChange={setSimilar}
        onPick={pick}
      />

      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden rounded-b-3xl" data-testid="graph-stage">
        <StageBackdrop />
        <GraphCanvas
          ref={canvasRef}
          data={visible}
          selectedId={selectedId}
          onSelect={select}
          insetRight={panelOpen ? insets.right : 0}
          insetBottom={Math.max(panelOpen ? insets.bottom : 0, message ? messageInset : 0)}
          aria-label={`Knowledge graph: ${plural(vc.items, "memory", "memories")}, ${plural(vc.entities, "thing", "things")} they mention, ${plural(vc.links, "link", "links")}.`}
          aria-describedby={instructionsId}
        />
        <p id={instructionsId} className="sr-only">
          Drag to move around, scroll or pinch to zoom, and click a dot to see its details. Keyboard: plus and minus zoom, 0
          fits everything, arrow keys move around, Escape clears the selection. Use “Find in graph” to jump to a memory or
          a name.
        </p>
        <p className="sr-only" aria-live="polite">
          {selectedLabel ? `Selected ${selectedLabel}, ${plural(selectedDegree, "connection", "connections")}.` : ""}
        </p>

        <div className="pointer-events-none absolute inset-0">
          <div
            className={
              panelOpen
                ? "absolute inset-x-3 top-3 flex flex-col items-center gap-2 md:right-[calc(22rem+1.5rem)]"
                : "absolute inset-x-3 top-3 flex flex-col items-center gap-2"
            }
          >
            {focusId ? <GraphFocusBanner label={focusLabel} onShowAll={showAll} /> : null}
            {similar && !building && vc.similar === 0 && visible.nodes.length > 1 ? <SimilarHint /> : null}
          </div>
          {building ? <GraphUpdatingPill className="absolute top-3 left-3" /> : null}

          {message ? null : (
            <GraphLegend
              kinds={presentKinds(vc)}
              hasSimilar={vc.similar > 0}
              className={panelOpen ? "absolute bottom-3 left-3 max-md:hidden" : "absolute bottom-3 left-3"}
            />
          )}
          <GraphZoomControls
            onZoomIn={() => canvasRef.current?.zoomIn()}
            onZoomOut={() => canvasRef.current?.zoomOut()}
            onFit={() => canvasRef.current?.fit()}
            className={
              panelOpen
                ? "absolute right-3 bottom-3 max-md:hidden md:right-[calc(22rem+1.5rem)]"
                : message
                  ? "absolute right-3 bottom-3 max-md:hidden"
                  : "absolute right-3 bottom-3"
            }
          />
        </div>

        {message ? (
          <div ref={setMessageEl} className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center sm:bottom-6">
            {message}
          </div>
        ) : null}

        {selectedId ? (
          <GraphDetails
            key={selectedId}
            ref={setPanelEl}
            id={selectedId}
            node={selectedNode}
            graph={visible}
            nodeById={nodeById}
            focusId={focusId}
            onClose={() => setSelectedId(null)}
            onLocate={locate}
            onFocusMode={focusMode}
            onShowAll={showAll}
          />
        ) : null}
      </div>
    </StageCard>
  );
}

/** Explains why "Similar memories" added no links. */
function SimilarHint() {
  const settings = useSettings();
  const embedded = useLiveQuery(() => db.items.where("embedded").equals(1).count(), []);
  if (embedded === undefined) return null;
  let text: ReactNode;
  if (!settings.semanticSearch) {
    text = (
      <>
        Similar links use meaning search, which is off.{" "}
        <Link href={ROUTES.data} className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
          Turn it on in Your data
        </Link>
      </>
    );
  } else if (embedded < 2) {
    text = "Your memories are still being prepared for meaning search. Similar links appear when that's done.";
  } else {
    text = "No memories are similar enough to link yet.";
  }
  return (
    <p
      className="pointer-events-auto max-w-sm rounded-2xl border border-zinc-200/80 bg-white/95 px-3.5 py-2 text-center text-[13px] leading-snug text-zinc-600 shadow-card animate-slide-up dark:border-white/10 dark:bg-ink-850/95 dark:text-zinc-300"
      data-testid="graph-similar-hint"
    >
      {text}
    </p>
  );
}

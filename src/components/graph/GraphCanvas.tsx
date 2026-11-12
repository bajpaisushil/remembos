"use client";
/**
 * React wrapper around the canvas graph engine. The engine is created once per mount and fed new
 * data, selection and panel insets through effects; parents drive the camera through the ref handle.
 */
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from "react";
import type { GraphData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GraphEngine } from "./engine/GraphEngine";

export interface GraphCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** Centre and zoom to a node; false when it isn't drawn. */
  focusNode: (id: string) => boolean;
  panBy: (dx: number, dy: number) => void;
  hasNode: (id: string) => boolean;
  focus: () => void;
}

export interface GraphCanvasProps {
  data: GraphData;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSettledChange?: (settled: boolean) => void;
  /** Space covered by floating panels (CSS px). */
  insetRight?: number;
  insetBottom?: number;
  "aria-label": string;
  "aria-describedby"?: string;
  className?: string;
  ref?: Ref<GraphCanvasHandle>;
}

export function GraphCanvas({
  data,
  selectedId,
  onSelect,
  onSettledChange,
  insetRight = 0,
  insetBottom = 0,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  className,
  ref,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GraphEngine | null>(null);

  const handleSelect = useEffectEvent((id: string | null) => onSelect(id));
  const handleSettled = useEffectEvent((settled: boolean) => onSettledChange?.(settled));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: GraphEngine;
    try {
      engine = new GraphEngine(canvas, {
        onSelect: (id) => handleSelect(id),
        onSettledChange: (settled) => handleSettled(settled),
      });
    } catch (err) {
      console.warn("[remembos] graph canvas unavailable", err);
      return;
    }
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setData(data);
  }, [data]);

  useEffect(() => {
    engineRef.current?.setSelected(selectedId);
  }, [selectedId, data]);

  useEffect(() => {
    engineRef.current?.setInsets(insetRight, insetBottom);
  }, [insetRight, insetBottom]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => engineRef.current?.zoomBy(1.5),
      zoomOut: () => engineRef.current?.zoomBy(1 / 1.5),
      fit: () => engineRef.current?.fit(),
      focusNode: (id) => engineRef.current?.focusNode(id) ?? false,
      panBy: (dx, dy) => engineRef.current?.panBy(dx, dy),
      hasNode: (id) => engineRef.current?.hasNode(id) ?? false,
      focus: () => canvasRef.current?.focus({ preventScroll: true }),
    }),
    [],
  );

  return (
    <canvas
      ref={canvasRef}
      data-testid="graph-canvas"
      tabIndex={0}
      role="application"
      aria-roledescription="knowledge graph"
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      className={cn(
        "absolute inset-0 block size-full touch-none select-none outline-none",
        "focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-brand-500 dark:focus-visible:outline-brand-400",
        className,
      )}
    />
  );
}

import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, StylesheetJson } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { ViewGraph } from '../analysis/views';
import { EDGE_COLORS, NODE_STYLE, VERDICT_COLOR } from '../theme';
import type { GapVerification } from '../analysis/verification';

cytoscape.use(fcose);

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

export interface GraphHandle {
  /** fit the view; `uncapped` ignores the minimum zoom so everything fits (used by the reveal on small screens) */
  fit: (opts?: { uncapped?: boolean }) => void;
  zoomBy: (factor: number) => void;
}

/** What the connection reveal wants drawn: element ids per step, the current step, and whether it is finished. */
export interface RevealFrame {
  steps: string[][];
  index: number;
  done: boolean;
  /** prefers-reduced-motion: no transitions, no stagger */
  reduced: boolean;
}

const RV_CLASSES = 'rv-hidden rv-past rv-focus rv-on rv-rest rv-instant';

interface Props {
  vg: ViewGraph;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onOpen: (nodeId: string) => void; // double-click: re-centre the view on this node
  verifications: Record<string, GapVerification>;
  reveal?: RevealFrame | null;
  ref?: Ref<GraphHandle>;
}

function edgeColor(kind: string, negated: boolean, claim: string | null, predicate: string) {
  if (negated) return EDGE_COLORS.negated;
  if (kind === 'derived-uses') return EDGE_COLORS.uses;
  if (kind === 'derived-aligned') return EDGE_COLORS.aligned;
  if (kind === 'derived-cites') return EDGE_COLORS.cites;
  if (kind === 'provenance') return EDGE_COLORS.provenance;
  if (kind === 'gap') return predicate === 'COULD_RESOLVE' ? EDGE_COLORS.resolve : EDGE_COLORS.gap;
  return claim === 'hypothesized' ? EDGE_COLORS.hypothesized : EDGE_COLORS.semantic;
}

function toElements(vg: ViewGraph, ver: Record<string, GapVerification>): ElementDefinition[] {
  const els: ElementDefinition[] = [];
  for (const n of vg.nodes) {
    const st = NODE_STYLE[n.type];
    const role = vg.roles.get(n.id) ?? 'context';
    const size = n.type === 'Paper' ? 30 : n.type === 'Gap' ? 26 : Math.min(30, 12 + Math.log1p(n.mentionCount) * 4 + n.paperCount * 1.5);
    els.push({
      group: 'nodes',
      data: {
        id: n.id, label: vg.display.get(n.id) ?? n.label, color: st.color, shape: st.shape, size, role, type: n.type,
        verdict: n.type === 'Gap' ? ver[n.id]?.verdict ?? 'unverified' : '',
        vcolor: n.type === 'Gap' ? VERDICT_COLOR[ver[n.id]?.verdict ?? ''] ?? '#f43f5e' : st.color,
      },
    });
  }
  for (const e of vg.edges) {
    els.push({
      group: 'edges',
      data: {
        id: e.id, source: e.source, target: e.target, label: e.label, kind: e.kind, claim: e.claimType ?? '', emph: vg.emphasis?.has(e.id) ? 1 : 0,
        color: edgeColor(e.kind, e.negated, e.claimType, e.predicate),
        lineStyle: e.claimType === 'hypothesized' || e.kind === 'gap' || e.kind === 'derived-aligned' ? 'dashed' : e.claimType === 'cited' || e.kind === 'derived-cites' ? 'dotted' : 'solid',
        width: e.kind === 'derived-uses' ? 0.8 : Math.min(4, 1 + Math.log1p(e.evidenceCount) * 0.6),
      },
    });
  }
  return els;
}

const STYLE: StylesheetJson = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)', shape: 'data(shape)' as never, width: 'data(size)', height: 'data(size)',
      label: 'data(label)', color: '#cbd5e1', 'font-size': 9, 'text-wrap': 'wrap', 'text-max-width': '120px',
      'text-valign': 'bottom', 'text-margin-y': 4, 'border-width': 0, 'min-zoomed-font-size': 7,
      'text-background-color': '#0a0f1c', 'text-background-opacity': 0.7, 'text-background-padding': '2px',
      'text-background-shape': 'roundrectangle',
      'transition-property': 'opacity', 'transition-duration': 150,
    },
  },
  { selector: 'node[type="Paper"]', style: { 'font-weight': 'bold', 'font-size': 9.5, color: '#e2e8f0' } },
  { selector: 'node[role="context"]', style: { opacity: 0.8 } },
  { selector: 'node[role="match"], node[role="focus"]', style: { 'border-width': 2, 'border-color': '#e2e8f0' } },
  { selector: 'node[role="aligned"]', style: { 'border-width': 2, 'border-color': '#6d8eff', 'border-style': 'dashed' } },
  { selector: 'node[role="resolution"]', style: { 'border-width': 2, 'border-color': '#34d399' } },
  {
    selector: 'node[type="Gap"]',
    style: { 'background-opacity': 0.15, 'border-width': 2, 'border-style': 'dashed', 'border-color': 'data(vcolor)', color: '#fecdd3' },
  },
  { selector: 'node[verdict="confirmed"]', style: { 'border-style': 'solid' } },
  { selector: 'node[type="Hypothesis"]', style: { 'border-width': 1.5, 'border-style': 'dashed', 'border-color': '#fde68a' } },
  {
    selector: 'edge',
    style: {
      width: 'data(width)', 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle',
      'arrow-scale': 0.6, 'curve-style': 'bezier', 'line-style': 'data(lineStyle)' as never, opacity: 0.75,
      label: 'data(label)', 'font-size': 7, color: '#94a3b8', 'text-rotation': 'autorotate', 'min-zoomed-font-size': 8,
      'text-background-color': '#0a0f1c', 'text-background-opacity': 0.85, 'text-background-padding': '1px',
      'transition-property': 'opacity', 'transition-duration': 150,
    },
  },
  { selector: 'edge[kind="derived-uses"]', style: { label: '', 'target-arrow-shape': 'none', opacity: 0.4 } },
  { selector: 'edge[kind="gap"]', style: { color: '#fda4af', 'font-size': 7 } },
  { selector: 'edge[emph = 1]', style: { width: 2.2, opacity: 0.95, label: 'data(label)', 'line-color': '#7d95e8', 'target-arrow-color': '#7d95e8', 'target-arrow-shape': 'triangle', color: '#c7d2fe' } },
  { selector: 'edge[emph = 1][claim = "hypothesized"]', style: { 'line-style': 'dashed' } },
  { selector: 'edge[emph = 1][kind = "derived-cites"]', style: { 'line-color': '#a78bfa', 'target-arrow-color': '#a78bfa', 'line-style': 'dotted', width: 2.5, color: '#ddd6fe', 'curve-style': 'unbundled-bezier', 'control-point-distances': [-120] as never } },
  { selector: '.faded', style: { opacity: 0.16 } },
  { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff', 'border-style': 'solid' } },
  { selector: 'edge:selected', style: { width: 4, 'line-color': '#ffffff', 'target-arrow-color': '#ffffff', label: 'data(label)', opacity: 1 } },
  { selector: '.hl', style: { opacity: 1 } },
  { selector: 'edge.hl', style: { label: 'data(label)' } },
  { selector: 'node.hover', style: { 'border-width': 2, 'border-color': '#ffffff' } },
  // ---- connection reveal: restrained fades and a single highlighted connection at a time ----
  { selector: '.rv-hidden, .rv-past, .rv-focus, .rv-on, .rv-rest', style: { 'transition-property': 'opacity, width, border-width, text-opacity', 'transition-duration': 420, 'transition-timing-function': 'ease-out' } },
  { selector: '.rv-hidden', style: { opacity: 0.06, 'text-opacity': 0 } },
  { selector: '.rv-past', style: { opacity: 0.32 } },
  { selector: '.rv-rest', style: { opacity: 0.32 } },
  { selector: '.rv-on', style: { opacity: 1, 'text-opacity': 1 } },
  { selector: 'node.rv-focus', style: { opacity: 1, 'text-opacity': 1, 'border-width': 3, 'border-color': '#e2e8f0' } },
  { selector: 'edge.rv-focus', style: { opacity: 1, 'text-opacity': 1, width: 3.4, label: 'data(label)' } },
  { selector: '.rv-instant', style: { 'transition-duration': 0 } },
];

/** 32-bit FNV-1a string hash (layout seed). */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Small deterministic PRNG returning floats in [0, 1), like Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Browser tests read the Cytoscape instance from window.__cy: always in dev, and in a production
 *  build only when the page is opened with an explicit ?e2e flag. */
const exposeForTests = import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e');

/** fit, but don't blow small graphs up to huge font sizes, and don't shrink large
 * graphs so far down that nodes overlap — pan/scroll instead of cramming everything in. */
function fitCapped(cy: Core) {
  cy.fit(undefined, 36);
  if (cy.zoom() > 1.4) {
    cy.zoom(1.4);
    cy.center();
  } else if (cy.zoom() < 0.5) {
    cy.zoom(0.5);
    cy.center();
  }
}

export default function GraphView({ vg, selection, onSelect, onOpen, verifications, reveal = null, ref }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const cb = useRef({ onSelect, onOpen });
  useEffect(() => {
    cb.current = { onSelect, onOpen };
  }, [onSelect, onOpen]);

  useImperativeHandle(ref, () => ({
    fit: (opts) => {
      const cy = cyRef.current;
      if (!cy) return;
      // re-read the container size first: it may have just become visible (mobile pane switch)
      cy.resize();
      if (opts?.uncapped) cy.fit(undefined, 24);
      else fitCapped(cy);
    },
    zoomBy: (f: number) => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.zoom({ level: cy.zoom() * f, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    },
  }), []);

  useEffect(() => {
    if (!box.current) return;
    const cy = cytoscape({ container: box.current, style: STYLE, minZoom: 0.1, maxZoom: 4 });
    cyRef.current = cy;
    // handle so browser tests can locate nodes on the canvas (dev, or production with ?e2e)
    if (exposeForTests) (window as unknown as { __cy?: Core }).__cy = cy;
    cy.on('tap', 'node', (e) => cb.current.onSelect({ kind: 'node', id: e.target.id() }));
    cy.on('tap', 'edge', (e) => cb.current.onSelect({ kind: 'edge', id: e.target.id() }));
    cy.on('tap', (e) => { if (e.target === cy) cb.current.onSelect(null); });
    cy.on('dbltap', 'node', (e) => cb.current.onOpen(e.target.id()));
    // pointer cursor + hover ring make nodes and edges discoverably clickable
    cy.on('mouseover', 'node, edge', (e) => { e.target.addClass('hover'); if (box.current) box.current.style.cursor = 'pointer'; });
    cy.on('mouseout', 'node, edge', (e) => { e.target.removeClass('hover'); if (box.current) box.current.style.cursor = ''; });
    // keep the drawing sized to its (responsive) container
    // keep the same point of the graph centred when the container changes size (e.g. details panel opens)
    const ro = new ResizeObserver(() => {
      const ext = cy.extent();
      const mx = (ext.x1 + ext.x2) / 2;
      const my = (ext.y1 + ext.y2) / 2;
      cy.resize();
      if (cy.elements().nonempty()) cy.pan({ x: cy.width() / 2 - mx * cy.zoom(), y: cy.height() / 2 - my * cy.zoom() });
    });
    ro.observe(box.current);
    return () => { ro.disconnect(); cy.destroy(); };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().remove();
    cy.add(toElements(vg, verifications));
    const n = vg.nodes.length;
    const layout = cy.layout({
      name: 'fcose', quality: n > 150 ? 'default' : 'proof', animate: false, randomize: true,
      nodeRepulsion: () => 25000, idealEdgeLength: () => 140, edgeElasticity: () => 0.3,
      nodeSeparation: 100, packComponents: !vg.fixed, gravity: 0.15, gravityRange: 4.0,
      ...(vg.fixed ? { fixedNodeConstraint: vg.fixed.filter((f) => cy.getElementById(f.id).nonempty()).map((f) => ({ nodeId: f.id, position: { x: f.x, y: f.y } })) } : {}),
    } as cytoscape.LayoutOptions);
    // Reproducible layout: fcose draws its random start from Math.random during this synchronous run
    // (animate: false). Seeding it from the exact set of visible elements gives the same picture for the
    // same dataset and view on every reload, while different views still get their own layout.
    const seed = fnv1a32(`${vg.nodes.map((x) => x.id).join('\u0001')}\u0002${vg.edges.map((x) => x.id).join('\u0001')}`);
    const original = Math.random;
    Math.random = mulberry32(seed);
    try {
      layout.run();
    } finally {
      Math.random = original;
    }
    fitCapped(cy);
  }, [vg, verifications]);

  // highlight neighbourhood of the selection (while a reveal runs, the reveal owns dimming; we only mark the selection)
  const revealActive = !!reveal;
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('faded hl').unselect();
    if (!selection) return;
    const el = cy.getElementById(selection.id);
    if (!el.nonempty()) return;
    el.select();
    if (revealActive) return;
    const hood = selection.kind === 'node' ? el.closedNeighborhood() : el.connectedNodes().union(el);
    cy.elements().not(hood).addClass('faded');
    hood.addClass('hl');
  }, [selection, vg, revealActive]);

  // Connection reveal: class changes once per step (no per-frame work). Within the current step the
  // elements appear in path order; those timers are cleared on every change, which cancels the animation
  // when the step, the pair or the view changes, or the component unmounts.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    cy.batch(() => cy.elements().removeClass(RV_CLASSES));
    if (!reveal) return;
    const papers = new Set([...(reveal.steps[0] ?? []), ...(reveal.steps[1] ?? [])]);
    const last = reveal.done ? reveal.steps.length - 1 : reveal.index;
    const current = reveal.done || reveal.index < 0 ? [] : reveal.steps[reveal.index];
    const stagger = !reveal.reduced && !reveal.done && current.length > 1;
    cy.batch(() => {
      const all = cy.elements();
      if (reveal.reduced) all.addClass('rv-instant');
      all.addClass(reveal.done ? 'rv-rest' : 'rv-hidden');
      for (let i = 0; i <= last; i++) {
        for (const id of reveal.steps[i] ?? []) {
          const el = cy.getElementById(id);
          el.removeClass('rv-hidden rv-rest');
          el.addClass(reveal.done || papers.has(id) ? 'rv-on' : i === reveal.index ? (stagger ? 'rv-hidden' : 'rv-focus') : 'rv-past');
        }
      }
      // the current step's papers stay fully visible while its path is drawn
      if (!reveal.done) for (const id of papers) if (current.includes(id)) cy.getElementById(id).removeClass('rv-on').addClass('rv-focus');
    });
    if (stagger)
      current.forEach((id, k) => {
        timers.push(setTimeout(() => cy.getElementById(id).removeClass('rv-hidden').addClass('rv-focus'), 120 + k * 170));
      });
    return () => timers.forEach(clearTimeout);
  }, [reveal, vg]);

  return <div ref={box} className="cy" role="img" aria-label="Knowledge graph. Use the panel on the left to navigate with the keyboard." />;
}

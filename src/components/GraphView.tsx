import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, StylesheetJson } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { ViewGraph } from '../analysis/views';
import { EDGE_COLORS, NODE_STYLE } from '../theme';
import type { GapVerification } from '../analysis/verification';

cytoscape.use(fcose);

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

interface Props {
  vg: ViewGraph;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onOpen: (nodeId: string) => void; // double-click: re-centre the view on this node
  verifications: Record<string, GapVerification>;
  fitSignal: number;
}

const VERDICT_COLOR: Record<string, string> = {
  confirmed: '#f43f5e',
  'partly-addressed': '#f59e0b',
  'closed-in-corpus': '#34d399',
  'extraction-artifact': '#94a3b8',
  'not-supported': '#64748b',
};

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
        id: e.id, source: e.source, target: e.target, label: e.label, kind: e.kind, claim: e.claimType ?? '',
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
      label: 'data(label)', color: '#cbd5e1', 'font-size': 8, 'text-wrap': 'wrap', 'text-max-width': '120px',
      'text-valign': 'bottom', 'text-margin-y': 3, 'border-width': 0, 'min-zoomed-font-size': 6,
      'text-background-color': '#0b1020', 'text-background-opacity': 0.6, 'text-background-padding': '1px',
    },
  },
  { selector: 'node[type="Paper"]', style: { 'font-weight': 'bold', 'font-size': 9, color: '#e2e8f0' } },
  { selector: 'node[role="context"]', style: { opacity: 0.75 } },
  { selector: 'node[role="match"], node[role="focus"]', style: { 'border-width': 2, 'border-color': '#e2e8f0' } },
  { selector: 'node[role="aligned"]', style: { 'border-width': 2, 'border-color': '#5b8cff', 'border-style': 'dashed' } },
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
      'arrow-scale': 0.6, 'curve-style': 'bezier', 'line-style': 'data(lineStyle)' as never, opacity: 0.8,
      label: 'data(label)', 'font-size': 6, color: '#94a3b8', 'text-rotation': 'autorotate', 'min-zoomed-font-size': 7,
      'text-background-color': '#0b1020', 'text-background-opacity': 0.8, 'text-background-padding': '1px',
    },
  },
  { selector: 'edge[kind="derived-uses"]', style: { label: '', 'target-arrow-shape': 'none', opacity: 0.45 } },
  { selector: 'edge[kind="gap"]', style: { color: '#fda4af', 'font-size': 7 } },
  { selector: '.faded', style: { opacity: 0.12 } },
  { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff', 'border-style': 'solid' } },
  { selector: 'edge:selected', style: { width: 4, 'line-color': '#ffffff', 'target-arrow-color': '#ffffff', label: 'data(label)', opacity: 1 } },
  { selector: '.hl', style: { opacity: 1 } },
  { selector: 'edge.hl', style: { label: 'data(label)' } },
];

/** fit, but don't blow small graphs up to huge font sizes, and don't shrink large
 * graphs so far down that nodes overlap — pan/scroll instead of cramming everything in. */
function fitCapped(cy: Core) {
  cy.fit(undefined, 30);
  if (cy.zoom() > 1.4) {
    cy.zoom(1.4);
    cy.center();
  } else if (cy.zoom() < 0.55) {
    cy.zoom(0.55);
    cy.center();
  }
}

export default function GraphView({ vg, selection, onSelect, onOpen, verifications, fitSignal }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const cb = useRef({ onSelect, onOpen });
  cb.current = { onSelect, onOpen };

  useEffect(() => {
    if (!ref.current) return;
    const cy = cytoscape({ container: ref.current, style: STYLE, minZoom: 0.1, maxZoom: 4 });
    cyRef.current = cy;
    cy.on('tap', 'node', (e) => cb.current.onSelect({ kind: 'node', id: e.target.id() }));
    cy.on('tap', 'edge', (e) => cb.current.onSelect({ kind: 'edge', id: e.target.id() }));
    cy.on('tap', (e) => { if (e.target === cy) cb.current.onSelect(null); });
    cy.on('dbltap', 'node', (e) => cb.current.onOpen(e.target.id()));
    return () => cy.destroy();
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().remove();
    cy.add(toElements(vg, verifications));
    const n = vg.nodes.length;
    cy.layout({
      name: 'fcose', quality: n > 150 ? 'default' : 'proof', animate: false, randomize: true,
      nodeRepulsion: () => 25000, idealEdgeLength: () => 140, edgeElasticity: () => 0.3,
      nodeSeparation: 100, packComponents: true, gravity: 0.15, gravityRange: 4.0,
    } as cytoscape.LayoutOptions).run();
    fitCapped(cy);
  }, [vg, verifications]);

  useEffect(() => { if (cyRef.current) fitCapped(cyRef.current); }, [fitSignal]);

  // highlight neighbourhood of the selection
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('faded hl').unselect();
    if (!selection) return;
    const el = cy.getElementById(selection.id);
    if (!el.nonempty()) return;
    el.select();
    const hood = selection.kind === 'node' ? el.closedNeighborhood() : cy.getElementById(selection.id).connectedNodes().union(el);
    cy.elements().not(hood).addClass('faded');
    hood.addClass('hl');
  }, [selection, vg]);

  return <div ref={ref} className="cy" role="img" aria-label="Knowledge graph" />;
}

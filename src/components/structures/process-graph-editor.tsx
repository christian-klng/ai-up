"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Diamond, GitBranch, Plus, Trash2 } from "lucide-react";
import type { ProcessGraph, ProcessNodeKind } from "@/lib/structures/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type FlowNodeData = { label: string; description?: string; kind: ProcessNodeKind };
type FlowNode = Node<FlowNodeData, "process">;

function ProcessNodeView({ data, selected }: NodeProps<FlowNode>) {
  const kind = data.kind;
  return (
    <div
      className={cn(
        "min-w-28 max-w-52 border bg-card px-3 py-1.5 text-center text-xs shadow-sm",
        kind === "start" || kind === "end" ? "rounded-full" : "rounded-md",
        kind === "start" && "border-emerald-500/60 bg-emerald-500/10",
        kind === "end" && "border-muted-foreground/40 bg-muted",
        kind === "decision" && "border-amber-500/60 bg-amber-500/10",
        selected && "ring-2 ring-primary",
      )}
    >
      {kind !== "start" && <Handle type="target" position={Position.Top} className="!size-2" />}
      <div className="flex items-center justify-center gap-1 font-medium">
        {kind === "decision" && <Diamond className="size-3 shrink-0 text-amber-600" />}
        <span className="truncate">{data.label}</span>
      </div>
      {data.description && <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{data.description}</div>}
      {kind !== "end" && <Handle type="source" position={Position.Bottom} className="!size-2" />}
    </div>
  );
}

const nodeTypes = { process: ProcessNodeView };

function toFlow(graph: ProcessGraph): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: "process" as const,
      position: { x: n.x, y: n.y },
      data: { label: n.label, description: n.description, kind: n.kind },
    })),
    edges: graph.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.condition || undefined })),
  };
}

function toGraph(nodes: FlowNode[], edges: Edge[]): ProcessGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.data.label,
      description: n.data.description || undefined,
      kind: n.data.kind,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    })),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, condition: typeof e.label === "string" && e.label ? e.label : undefined })),
  };
}

export function ProcessGraphEditor({ value, onChange, readOnly = false, className }: { value: ProcessGraph; onChange?: (graph: ProcessGraph) => void; readOnly?: boolean; className?: string }) {
  const t = useTranslations("knowledge.structured.graph");
  const initial = useMemo(() => toFlow(value), [value]);
  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const counter = useRef(value.nodes.length + 1);

  // Emit after commit, never during render — ReactFlow fires change events
  // (e.g. dimensions on mount) while it is still rendering.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    onChangeRef.current?.(toGraph(nodes, edges));
  }, [nodes, edges]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds) => addEdge({ ...conn, id: `e-${conn.source}-${conn.target}-${eds.length}` }, eds));
  }, []);

  const addNode = (kind: ProcessNodeKind) => {
    let id = `n${counter.current++}`;
    while (nodes.some((n) => n.id === id)) id = `n${counter.current++}`;
    const maxY = nodes.reduce((m, n) => Math.max(m, n.position.y), 0);
    const label = kind === "decision" ? `${t("addDecision")} ${counter.current - 1}` : kind === "end" ? t("addEnd") : `${t("addStep")} ${counter.current - 1}`;
    setNodes((nds) => [...nds, { id, type: "process", position: { x: 80, y: maxY + 90 }, data: { label, kind } }]);
  };

  const selectedNode = nodes.find((n) => n.selected);
  const selectedEdge = !selectedNode ? edges.find((e) => e.selected) : undefined;

  const updateSelectedNode = (patch: Partial<FlowNodeData>) => {
    if (!selectedNode) return;
    setNodes((nds) => nds.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  const updateSelectedEdge = (condition: string) => {
    if (!selectedEdge) return;
    setEdges((eds) => eds.map((e) => (e.id === selectedEdge.id ? { ...e, label: condition || undefined } : e)));
  };

  const deleteSelection = () => {
    const nodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((e) => !e.selected && !nodeIds.has(e.source) && !nodeIds.has(e.target)));
  };

  return (
    <div className={cn("grid grid-cols-1 gap-2", className)}>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => addNode("step")}>
            <Plus className="size-3.5" /> {t("addStep")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => addNode("decision")}>
            <GitBranch className="size-3.5" /> {t("addDecision")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => addNode("end")}>
            <Plus className="size-3.5" /> {t("addEnd")}
          </Button>
          {(selectedNode || selectedEdge) && (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={deleteSelection}>
              <Trash2 className="size-3.5" /> {t("deleteSelection")}
            </Button>
          )}
        </div>
      )}
      <div className="h-80 rounded-md border bg-background">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={readOnly ? undefined : onConnect}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable={!readOnly}
            fitView
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      {!readOnly && selectedNode && (
        <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/40 p-2 sm:grid-cols-2">
          <label className="grid grid-cols-1 gap-1 text-xs">
            {t("nodeLabel")}
            <Input value={selectedNode.data.label} onChange={(e) => updateSelectedNode({ label: e.target.value })} className="h-8 text-sm" />
          </label>
          <label className="grid grid-cols-1 gap-1 text-xs sm:row-span-2">
            {t("nodeDescription")}
            <Textarea value={selectedNode.data.description ?? ""} onChange={(e) => updateSelectedNode({ description: e.target.value })} rows={2} className="text-sm" />
          </label>
        </div>
      )}
      {!readOnly && selectedEdge && (
        <div className="grid grid-cols-1 gap-1 rounded-md border bg-muted/40 p-2 text-xs">
          {t("edgeCondition")}
          <Input value={typeof selectedEdge.label === "string" ? selectedEdge.label : ""} onChange={(e) => updateSelectedEdge(e.target.value)} className="h-8 text-sm" />
        </div>
      )}
      {!readOnly && <p className="text-xs text-muted-foreground">{t("hint")}</p>}
    </div>
  );
}

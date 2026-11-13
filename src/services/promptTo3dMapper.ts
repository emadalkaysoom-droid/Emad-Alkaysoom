import {
  extractColorFromPrompt,
  type BlueprintPart,
  type PartPrimitive,
  type Procedural3DBlueprint,
} from '../../shared/procedural3d';

function computeBoundingBoxFromParts(parts: BlueprintPart[]): { width: number; height: number; depth: number } {
  let maxX = 1;
  let maxY = 1;
  let maxZ = 1;
  for (const pt of parts) {
    const halfW = pt.primitive === 'box' ? pt.dimensions[0] / 2 : pt.dimensions[0];
    const halfH =
      pt.primitive === 'box' || pt.primitive === 'cylinder' || pt.primitive === 'cone'
        ? pt.dimensions[pt.primitive === 'box' ? 1 : pt.primitive === 'cylinder' ? 2 : 1] / 2
        : pt.dimensions[0];
    const halfD = pt.primitive === 'box' ? pt.dimensions[2] / 2 : pt.dimensions[0];
    maxX = Math.max(maxX, (Math.abs(pt.position[0]) + halfW) * 2);
    maxY = Math.max(maxY, pt.position[1] + halfH);
    maxZ = Math.max(maxZ, (Math.abs(pt.position[2]) + halfD) * 2);
  }
  return {
    width: Number(maxX.toFixed(2)),
    height: Number(maxY.toFixed(2)),
    depth: Number(maxZ.toFixed(2)),
  };
}

export interface PrimitiveSceneNode {
  id: string;
  name: string;
  role: 'primary' | 'secondary' | 'accent';
  primitive: PartPrimitive;
  dimensions: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
  mappedFromKeyword: string;
  isPlaceholder: boolean;
}

export interface CreativeIntentAcknowledgment {
  agentName: string;
  mode: 'contextual_edit' | 'full_synthesis';
  understoodSubject: string;
  detectedKeywords: string[];
  actionTaken: string;
  acknowledgmentMessage: string;
  mappedNodes: PrimitiveSceneNode[];
}

export interface PromptTo3DResult {
  blueprint: Procedural3DBlueprint;
  sceneNodes: PrimitiveSceneNode[];
  intent: CreativeIntentAcknowledgment;
  provider: string;
  model: string;
}

export function buildPlaceholderSceneGraph(currentBlueprint: Procedural3DBlueprint): PrimitiveSceneNode[] {
  return currentBlueprint.parts.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    primitive: p.primitive,
    dimensions: [...p.dimensions] as [number, number, number],
    position: [...p.position] as [number, number, number],
    rotation: [...p.rotation] as [number, number, number],
    color: '#38bdf8',
    mappedFromKeyword: 'current-state-placeholder',
    isPlaceholder: true,
  }));
}

export function blueprintToSceneNodes(
  blueprint: Procedural3DBlueprint,
  keywordSource = 'prompt-synthesis',
  isPlaceholder = false
): PrimitiveSceneNode[] {
  return blueprint.parts.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    primitive: p.primitive,
    dimensions: [...p.dimensions] as [number, number, number],
    position: [...p.position] as [number, number, number],
    rotation: [...p.rotation] as [number, number, number],
    color: p.color,
    mappedFromKeyword: keywordSource,
    isPlaceholder,
  }));
}

function extractKeywords(prompt: string): string[] {
  const tokens = prompt
    .toLowerCase()
    .split(/[\s,.;:!؟،]+/)
    .filter((t) => t.length >= 2);
  return Array.from(new Set(tokens)).slice(0, 8);
}

export function tryContextualPromptEdit(
  rawPrompt: string,
  currentBlueprint: Procedural3DBlueprint,
  selectedPartId: string | null
): PromptTo3DResult | null {
  const prompt = rawPrompt.trim();
  const p = prompt.toLowerCase();
  if (!prompt) return null;

  const clonedParts: BlueprintPart[] = currentBlueprint.parts.map((pt) => ({
    ...pt,
    dimensions: [...pt.dimensions] as [number, number, number],
    position: [...pt.position] as [number, number, number],
    rotation: [...pt.rotation] as [number, number, number],
  }));

  const palette = extractColorFromPrompt(prompt);
  const topY = currentBlueprint.boundingBox.height || 2.0;

  // 1. Add antenna / mast / beacon on top of current blueprint placeholder bounds
  if (/\b(add|attach|place|put)\b.*\b(antenna|mast|beacon|sensor|radar)\b|أضف.*(هوائي|رادار|مستشعر)/.test(p)) {
    const accentColor = palette?.primary || '#38bdf8';
    const mast: BlueprintPart = {
      id: `ctx-mast-${clonedParts.length + 1}`,
      name: 'Telemetry Antenna Mast',
      role: 'accent',
      primitive: 'cylinder',
      dimensions: [0.05, 0.08, 0.9],
      position: [0, Number((topY + 0.4).toFixed(2)), 0],
      rotation: [0, 0, 0],
      color: '#cbd5e1',
      roughness: 0.25,
      metalness: 0.85,
    };
    const tip: BlueprintPart = {
      id: `ctx-beacon-${clonedParts.length + 2}`,
      name: 'Optical Sensor Beacon',
      role: 'accent',
      primitive: 'sphere',
      dimensions: [0.14, 24, 16],
      position: [0, Number((topY + 0.9).toFixed(2)), 0],
      rotation: [0, 0, 0],
      color: accentColor,
      roughness: 0.15,
      metalness: 0.3,
      emissive: accentColor,
    };
    const updatedParts = [...clonedParts, mast, tip];
    const updatedBlueprint: Procedural3DBlueprint = {
      ...currentBlueprint,
      prompt: `${currentBlueprint.prompt} + ${prompt}`,
      parts: updatedParts,
      boundingBox: computeBoundingBoxFromParts(updatedParts),
    };
    const addedNodes: PrimitiveSceneNode[] = [
      {
        id: mast.id,
        name: mast.name,
        role: mast.role,
        primitive: mast.primitive,
        dimensions: mast.dimensions,
        position: mast.position,
        rotation: mast.rotation,
        color: mast.color,
        mappedFromKeyword: 'antenna -> cylinder',
        isPlaceholder: false,
      },
      {
        id: tip.id,
        name: tip.name,
        role: tip.role,
        primitive: tip.primitive,
        dimensions: tip.dimensions,
        position: tip.position,
        rotation: tip.rotation,
        color: tip.color,
        mappedFromKeyword: 'beacon -> sphere',
        isPlaceholder: false,
      },
    ];

    return {
      blueprint: updatedBlueprint,
      sceneNodes: addedNodes,
      provider: 'omnix-scene-mapper',
      model: 'prompt-to-3d-contextual',
      intent: {
        agentName: 'OMNI 3D Architect',
        mode: 'contextual_edit',
        understoodSubject: `Attach telemetry antenna & sensor beacon onto "${currentBlueprint.title}"`,
        detectedKeywords: extractKeywords(prompt),
        actionTaken: `Mounted 2 primitive nodes (cylinder mast + sphere beacon) at y=${topY.toFixed(2)} m above current placeholder bounds.`,
        acknowledgmentMessage: `Understood your request ("${prompt}") — mounted a ${accentColor} sensor beacon and antenna mast atop "${currentBlueprint.title}".`,
        mappedNodes: addedNodes,
      },
    };
  }

  // 2. Add dome / canopy on top
  if (/\b(add|attach|place)\b.*\b(dome|canopy|cupola)\b|أضف.*(قبة)/.test(p)) {
    const domeColor = palette?.primary || '#38bdf8';
    const dome: BlueprintPart = {
      id: `ctx-dome-${clonedParts.length + 1}`,
      name: 'Observatory Dome Canopy',
      role: 'accent',
      primitive: 'sphere',
      dimensions: [Math.min(1.4, Math.max(0.45, currentBlueprint.boundingBox.width * 0.25)), 24, 16],
      position: [0, Number((topY + 0.15).toFixed(2)), 0],
      rotation: [0, 0, 0],
      color: domeColor,
      roughness: 0.15,
      metalness: 0.2,
      clearcoat: 0.9,
    };
    const updatedParts = [...clonedParts, dome];
    const updatedBlueprint: Procedural3DBlueprint = {
      ...currentBlueprint,
      prompt: `${currentBlueprint.prompt} + ${prompt}`,
      parts: updatedParts,
      boundingBox: computeBoundingBoxFromParts(updatedParts),
    };
    const nodes = blueprintToSceneNodes({ ...updatedBlueprint, parts: [dome] }, 'dome -> sphere');
    return {
      blueprint: updatedBlueprint,
      sceneNodes: nodes,
      provider: 'omnix-scene-mapper',
      model: 'prompt-to-3d-contextual',
      intent: {
        agentName: 'OMNI 3D Architect',
        mode: 'contextual_edit',
        understoodSubject: `Add dome canopy onto "${currentBlueprint.title}"`,
        detectedKeywords: extractKeywords(prompt),
        actionTaken: `Appended spherical dome primitive at y=${dome.position[1]} m.`,
        acknowledgmentMessage: `Acknowledged creative edit ("${prompt}") — added a ${domeColor} dome canopy onto "${currentBlueprint.title}".`,
        mappedNodes: nodes,
      },
    };
  }

  // 3. Add orbital ring / halo around current model
  if (/\b(add|attach)\b.*\b(ring|halo|shield)\b|أضف.*(حلقة)/.test(p)) {
    const ringColor = palette?.primary || '#38bdf8';
    const ringRadius = Math.max(1.2, Math.max(currentBlueprint.boundingBox.width, currentBlueprint.boundingBox.depth) * 0.58);
    const ring: BlueprintPart = {
      id: `ctx-ring-${clonedParts.length + 1}`,
      name: 'Stabilizer Orbital Ring',
      role: 'accent',
      primitive: 'torus',
      dimensions: [Number(ringRadius.toFixed(2)), 0.08, 16],
      position: [0, Number((topY * 0.55).toFixed(2)), 0],
      rotation: [Math.PI / 2, 0, 0],
      color: ringColor,
      roughness: 0.2,
      metalness: 0.8,
      emissive: ringColor,
      spinAxis: 'z',
    };
    const updatedParts = [...clonedParts, ring];
    const updatedBlueprint: Procedural3DBlueprint = {
      ...currentBlueprint,
      prompt: `${currentBlueprint.prompt} + ${prompt}`,
      parts: updatedParts,
      boundingBox: computeBoundingBoxFromParts(updatedParts),
    };
    const nodes = blueprintToSceneNodes({ ...updatedBlueprint, parts: [ring] }, 'ring -> torus');
    return {
      blueprint: updatedBlueprint,
      sceneNodes: nodes,
      provider: 'omnix-scene-mapper',
      model: 'prompt-to-3d-contextual',
      intent: {
        agentName: 'OMNI 3D Architect',
        mode: 'contextual_edit',
        understoodSubject: `Wrap orbital ring around "${currentBlueprint.title}"`,
        detectedKeywords: extractKeywords(prompt),
        actionTaken: `Generated torus stabilizer ring (radius ${ring.dimensions[0]} m) centered on current scene placeholder.`,
        acknowledgmentMessage: `Understood ("${prompt}") — mounted a rotating ${ringColor} torus stabilizer ring around "${currentBlueprint.title}".`,
        mappedNodes: nodes,
      },
    };
  }

  // 4. Recolor selected part or primary assembly
  if (palette && /\b(make|color|paint|change|turn)\b.*\b(selected|part|model|it|this)\b|لون|اجعل/.test(p)) {
    const targetId = selectedPartId || clonedParts[0]?.id;
    const updatedParts = clonedParts.map((pt) => {
      if (selectedPartId ? pt.id === targetId : pt.role === 'primary' || pt.id === targetId) {
        return { ...pt, color: palette.primary };
      }
      return pt;
    });
    const updatedBlueprint: Procedural3DBlueprint = {
      ...currentBlueprint,
      parts: updatedParts,
    };
    const changed = updatedParts.filter((pt) => pt.color === palette.primary);
    const nodes = blueprintToSceneNodes({ ...updatedBlueprint, parts: changed }, `color -> ${palette.primary}`);
    return {
      blueprint: updatedBlueprint,
      sceneNodes: nodes,
      provider: 'omnix-scene-mapper',
      model: 'prompt-to-3d-contextual',
      intent: {
        agentName: 'OMNI 3D Architect',
        mode: 'contextual_edit',
        understoodSubject: selectedPartId ? `Recolor selected part (${selectedPartId})` : `Recolor primary structure of "${currentBlueprint.title}"`,
        detectedKeywords: extractKeywords(prompt),
        actionTaken: `Applied ${palette.primary} finish across ${changed.length} target scene node(s).`,
        acknowledgmentMessage: `Processed color directive ("${prompt}") — updated ${changed.length} part(s) to ${palette.primary}.`,
        mappedNodes: nodes,
      },
    };
  }

  // 5. Contextual scale transformation on current assembly
  const scaleMatch = prompt.match(/\b(?:scale|resize|تكبير|تصغير)\s*(?:by|to)?\s*(\d+(?:\.\d+)?)x?\b/i);
  if (scaleMatch) {
    const factor = Math.min(2.5, Math.max(0.4, Number(scaleMatch[1])));
    if (Number.isFinite(factor)) {
      const updatedParts = clonedParts.map((pt) => ({
        ...pt,
        dimensions: [
          Number((pt.dimensions[0] * factor).toFixed(2)),
          pt.primitive === 'sphere' ? pt.dimensions[1] : Number((pt.dimensions[1] * factor).toFixed(2)),
          pt.primitive === 'sphere' || pt.primitive === 'torus' || pt.primitive === 'cone'
            ? pt.dimensions[2]
            : Number((pt.dimensions[2] * factor).toFixed(2)),
        ] as [number, number, number],
        position: [
          Number((pt.position[0] * factor).toFixed(2)),
          Number((pt.position[1] * factor).toFixed(2)),
          Number((pt.position[2] * factor).toFixed(2)),
        ] as [number, number, number],
      }));
      const updatedBlueprint: Procedural3DBlueprint = {
        ...currentBlueprint,
        parts: updatedParts,
        boundingBox: computeBoundingBoxFromParts(updatedParts),
      };
      const nodes = blueprintToSceneNodes(updatedBlueprint, `scale ${factor}x`);
      return {
        blueprint: updatedBlueprint,
        sceneNodes: nodes,
        provider: 'omnix-scene-mapper',
        model: 'prompt-to-3d-contextual',
        intent: {
          agentName: 'OMNI 3D Architect',
          mode: 'contextual_edit',
          understoodSubject: `Rescale "${currentBlueprint.title}" by ${factor}x`,
          detectedKeywords: extractKeywords(prompt),
          actionTaken: `Scaled ${updatedParts.length} scene nodes & positions uniformly by ${factor}x.`,
          acknowledgmentMessage: `Understood scale directive ("${prompt}") — resized "${currentBlueprint.title}" to ${updatedBlueprint.boundingBox.width}×${updatedBlueprint.boundingBox.height}×${updatedBlueprint.boundingBox.depth} m.`,
          mappedNodes: nodes,
        },
      };
    }
  }

  return null;
}

export async function mapPromptTo3DScene(params: {
  prompt: string;
  workspaceId: string;
  projectId: string | null;
  currentBlueprint: Procedural3DBlueprint;
  selectedPartId: string | null;
}): Promise<PromptTo3DResult> {
  // First check whether the prompt is a contextual modification anchored to the current state placeholders
  const contextual = tryContextualPromptEdit(
    params.prompt,
    params.currentBlueprint,
    params.selectedPartId
  );
  if (contextual) {
    return contextual;
  }

  // Otherwise synthesize a full 3D primitive scene graph via backend AI / procedural fallback
  const res = await fetch('/api/3d/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      prompt: params.prompt.trim(),
      currentSceneContext: {
        title: params.currentBlueprint.title,
        partCount: params.currentBlueprint.parts.length,
        partNames: params.currentBlueprint.parts.slice(0, 6).map((p) => p.name),
      },
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.blueprint) {
    throw new Error(data.error || '3D synthesis failed');
  }

  const bp = data.blueprint as Procedural3DBlueprint;
  const nodes = blueprintToSceneNodes(bp, bp.category.toLowerCase());
  const acknowledgmentMessage =
    data.intentAcknowledgment ||
    `Interpreted "${params.prompt.trim()}" as "${bp.title}" and mapped ${bp.parts.length} parametric primitive nodes (${bp.boundingBox.width}×${bp.boundingBox.height}×${bp.boundingBox.depth} m).`;

  return {
    blueprint: bp,
    sceneNodes: nodes,
    provider: data.provider || 'local-deterministic',
    model: data.model || 'omnix-procedural-3d',
    intent: {
      agentName: 'OMNI 3D Architect',
      mode: 'full_synthesis',
      understoodSubject: bp.title,
      detectedKeywords: extractKeywords(params.prompt),
      actionTaken: `Replaced placeholder scene with ${bp.parts.length} mapped 3D primitive objects (${bp.category}).`,
      acknowledgmentMessage,
      mappedNodes: nodes,
    },
  };
}

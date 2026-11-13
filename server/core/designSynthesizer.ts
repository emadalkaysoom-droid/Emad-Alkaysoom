import {
  generate3DBlueprint,
  generateWorldBlueprint,
  sanitize3DBlueprint,
  sanitizeWorldBlueprint,
  type Procedural3DBlueprint,
  type ProceduralWorldBlueprint,
} from '../../shared/procedural3d.ts';
import { invokeModelGateway } from './modelGateway.ts';

function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function synthesize3DBlueprint(params: {
  prompt: string;
  workspaceId: string;
  preferredModel?: string;
  currentSceneContext?: { title: string; partCount: number; partNames: string[] };
}): Promise<{
  blueprint: Procedural3DBlueprint;
  intentAcknowledgment: string;
  provider: string;
  model: string;
  isFallback: boolean;
}> {
  const localBlueprint = generate3DBlueprint(params.prompt);
  const fallbackAck = `Recognized "${params.prompt}" and mapped it to "${localBlueprint.title}" using ${localBlueprint.parts.length} parametric primitives (${localBlueprint.boundingBox.width}×${localBlueprint.boundingBox.height}×${localBlueprint.boundingBox.depth} m).`;
  const contextLine = params.currentSceneContext
    ? `\nCurrent studio placeholder assembly: "${params.currentSceneContext.title}" (${params.currentSceneContext.partCount} parts: ${params.currentSceneContext.partNames.join(', ')}).`
    : '';

  const gatewayRes = await invokeModelGateway({
    workspaceId: params.workspaceId,
    preferredModel: params.preferredModel,
    thinkingLevel: 'LOW',
    temperature: 0.45,
    responseMimeType: 'application/json',
    systemInstruction: `You are OMNI 3D Parametric Architect. Convert ANY user description (English or Arabic) into an accurate, visually recognizable multi-part 3D assembly JSON.
Rules:
- Output ONLY valid JSON matching:
  {
    "title": "Descriptive Model Title",
    "category": "Domain Category",
    "intentAcknowledgment": "1-2 concise sentences explicitly acknowledging the user's creative intent, target colors/materials, and the key 3D primitive components built.",
    "parts": [
      {
        "id": "unique_snake_id",
        "name": "Human Readable Part Name",
        "role": "primary" | "secondary" | "accent",
        "primitive": "box" | "cylinder" | "sphere" | "cone" | "torus",
        "dimensions": [d0, d1, d2],
        "position": [x, y, z],
        "rotation": [rx, ry, rz],
        "color": "#RRGGBB",
        "roughness": 0.05..1.0,
        "metalness": 0.0..1.0,
        "clearcoat": 0.0..1.0,
        "emissive": "#RRGGBB (optional for lights/screens/windows)",
        "spinAxis": "x" | "y" | "z" (optional ONLY for rotors/wheels/blades/rings)
      }
    ]
  }
- Primitive dimension semantics (meters, Three.js):
  * box: [width, height, depth]
  * cylinder: [radiusTop, radiusBottom, height]
  * sphere: [radius, 24, 16]
  * cone: [radius, height, 24]
  * torus: [ringRadius, tubeRadius, 16]
- Build 6 to 18 well-proportioned, interconnected parts that clearly depict every object, color, material, and detail requested by the user. Ground the assembly cleanly on y >= 0.`,
    prompt: `Design a detailed 3D assembly matching this exact user description:\n"${params.prompt}"${contextLine}`,
    localFallbackHandler: () => JSON.stringify({ ...localBlueprint, intentAcknowledgment: fallbackAck }),
  });

  if (!gatewayRes.isFallback) {
    const parsed = extractJsonObject(gatewayRes.text) as Record<string, unknown> | null;
    const sanitized = sanitize3DBlueprint(parsed, params.prompt);
    if (sanitized) {
      const rawAck =
        parsed && typeof parsed.intentAcknowledgment === 'string' && parsed.intentAcknowledgment.trim().length > 8
          ? parsed.intentAcknowledgment.trim()
          : `Understood "${params.prompt}" — engineered "${sanitized.title}" with ${sanitized.parts.length} primitive parts.`;
      return {
        blueprint: sanitized,
        intentAcknowledgment: rawAck,
        provider: gatewayRes.provider,
        model: gatewayRes.model,
        isFallback: false,
      };
    }
  }

  return {
    blueprint: localBlueprint,
    intentAcknowledgment: fallbackAck,
    provider: 'local-deterministic',
    model: 'omnix-procedural-3d',
    isFallback: true,
  };
}

export async function synthesizeWorldBlueprint(params: {
  prompt: string;
  workspaceId: string;
  preferredModel?: string;
}): Promise<{
  world: ProceduralWorldBlueprint;
  provider: string;
  model: string;
  isFallback: boolean;
}> {
  const localWorld = generateWorldBlueprint(params.prompt);

  const gatewayRes = await invokeModelGateway({
    workspaceId: params.workspaceId,
    preferredModel: params.preferredModel,
    thinkingLevel: 'LOW',
    temperature: 0.45,
    responseMimeType: 'application/json',
    systemInstruction: `You are OMNI WORLD Procedural Environment Architect. Convert ANY user description (English or Arabic) into a rich 3D digital world JSON.
Rules:
- Output ONLY valid JSON matching:
  {
    "title": "World Title",
    "biome": "urban_campus" | "desert_outpost" | "alpine_research" | "coastal_port" | "mars_colony" | "arctic_station" | "cyber_metropolis",
    "skyColor": "#RRGGBB",
    "fogColor": "#RRGGBB",
    "terrainColor": "#RRGGBB",
    "waterColor": "#RRGGBB",
    "foliageColor": "#RRGGBB",
    "accentColor": "#RRGGBB",
    "waterLevel": -4..1.5 (use > 0.15 when water, ocean, river, lake, island, or harbor is requested),
    "gravity": 1.6..12.0 (3.72 for Mars, 1.62 for Moon, 9.81 Earth),
    "timeOfDay": "day" | "dusk" | "night",
    "terrainAmplitude": 0.3..5.5,
    "features": ["reflective_water", "bridge", "solar_array"],
    "buildings": [
      { "id": "bld-1", "name": "Structure Name", "x": -35..35, "z": -35..35, "width": 2..10, "height": 3..26, "depth": 2..10, "floors": 1..12, "color": "#RRGGBB", "roofType": "flat" | "spire" | "dome" }
    ],
    "treePositions": [
      { "x": -38..38, "z": -38..38, "scale": 0.6..1.8 }
    ],
    "actors": [
      { "id": "actor-1", "name": "Unit Name", "x": -18..18, "z": -18..18, "speed": 1..5, "heading": 0..6.28, "color": "#RRGGBB" }
    ]
  }
- Keep buildings away from the main axial roads (|x| > 3.5 and |z| > 3.5). Include 8 to 22 buildings, 0 to 36 trees (0 for barren Mars/Moon), and 3 to 5 domain-appropriate autonomous actors.`,
    prompt: `Design a 3D interactive world matching this exact user description:\n"${params.prompt}"`,
    localFallbackHandler: () => JSON.stringify(localWorld),
  });

  if (!gatewayRes.isFallback) {
    const parsed = extractJsonObject(gatewayRes.text);
    const sanitized = sanitizeWorldBlueprint(parsed, params.prompt);
    if (sanitized) {
      return {
        world: sanitized,
        provider: gatewayRes.provider,
        model: gatewayRes.model,
        isFallback: false,
      };
    }
  }

  return {
    world: localWorld,
    provider: 'local-deterministic',
    model: 'omnix-procedural-world',
    isFallback: true,
  };
}

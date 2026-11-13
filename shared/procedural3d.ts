export type PartPrimitive = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus';

export interface BlueprintPart {
  id: string;
  name: string;
  role: 'primary' | 'secondary' | 'accent';
  primitive: PartPrimitive;
  dimensions: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
  roughness: number;
  metalness: number;
  clearcoat?: number;
  emissive?: string;
  spinAxis?: 'x' | 'y' | 'z';
}

export interface Procedural3DBlueprint {
  title: string;
  category: string;
  prompt: string;
  boundingBox: { width: number; height: number; depth: number };
  parts: BlueprintPart[];
}

export interface WorldBuilding {
  id: string;
  name?: string;
  x: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  floors: number;
  color: string;
  roofType: 'flat' | 'spire' | 'dome';
}

export interface WorldAgentActor {
  id: string;
  name: string;
  x: number;
  z: number;
  speed: number;
  heading: number;
  color: string;
}

export type WorldBiome =
  | 'urban_campus'
  | 'desert_outpost'
  | 'alpine_research'
  | 'coastal_port'
  | 'mars_colony'
  | 'arctic_station'
  | 'cyber_metropolis';

export interface ProceduralWorldBlueprint {
  title: string;
  biome: WorldBiome;
  prompt: string;
  skyColor: string;
  fogColor: string;
  terrainColor: string;
  waterColor?: string;
  foliageColor?: string;
  accentColor?: string;
  waterLevel: number;
  gravity: number;
  timeOfDay: 'day' | 'dusk' | 'night';
  terrainAmplitude: number;
  features?: string[];
  buildings: WorldBuilding[];
  roadControlPoints: Array<[number, number]>;
  treePositions: Array<{ x: number; z: number; scale: number }>;
  actors: WorldAgentActor[];
}

interface PaletteChoice {
  primary: string;
  secondary: string;
  accent: string;
  label: string;
}

const COLOR_RULES: Array<{ pattern: RegExp; palette: PaletteChoice }> = [
  { pattern: /\b(red|crimson|scarlet)\b|أحمر|حمراء/, palette: { primary: '#dc2626', secondary: '#1e293b', accent: '#f97316', label: 'Crimson' } },
  { pattern: /\b(blue|navy|azure|cobalt)\b|أزرق|زرقاء/, palette: { primary: '#2563eb', secondary: '#0f172a', accent: '#38bdf8', label: 'Cobalt' } },
  { pattern: /\b(green|emerald|forest|olive)\b|أخضر|خضراء/, palette: { primary: '#059669', secondary: '#1e293b', accent: '#34d399', label: 'Emerald' } },
  { pattern: /\b(gold|golden|yellow|amber)\b|ذهبي|ذهبية|أصفر|صفراء/, palette: { primary: '#d97706', secondary: '#1e293b', accent: '#fbbf24', label: 'Gold' } },
  { pattern: /\b(purple|violet|magenta)\b|بنفسجي|أرجواني/, palette: { primary: '#7c3aed', secondary: '#1e1b4b', accent: '#c084fc', label: 'Violet' } },
  { pattern: /\b(orange|rust|copper)\b|برتقالي|نحاسي/, palette: { primary: '#ea580c', secondary: '#27272a', accent: '#fb923c', label: 'Copper' } },
  { pattern: /\b(white|ivory|pearl|snow)\b|أبيض|بيضاء/, palette: { primary: '#f1f5f9', secondary: '#334155', accent: '#38bdf8', label: 'Pearl' } },
  { pattern: /\b(black|obsidian|matte|stealth|dark)\b|أسود|سوداء|داكن/, palette: { primary: '#18181b', secondary: '#334155', accent: '#38bdf8', label: 'Obsidian' } },
  { pattern: /\b(silver|chrome|titanium|steel|metallic)\b|فضي|معدني|تيتانيوم/, palette: { primary: '#cbd5e1', secondary: '#475569', accent: '#38bdf8', label: 'Titanium' } },
  { pattern: /\b(cyan|teal|aqua)\b|سماوي|تركواز/, palette: { primary: '#0891b2', secondary: '#0f172a', accent: '#22d3ee', label: 'Cyan' } },
  { pattern: /\b(wood|wooden|oak|mahogany|brown)\b|خشب|خشبي|بني/, palette: { primary: '#92400e', secondary: '#451a03', accent: '#d97706', label: 'Timber' } },
];

export function extractColorFromPrompt(prompt: string): PaletteChoice | null {
  const p = prompt.toLowerCase();
  let best: { index: number; palette: PaletteChoice } | null = null;
  for (const rule of COLOR_RULES) {
    const match = rule.pattern.exec(p);
    if (match && (best === null || match.index < best.index)) {
      best = { index: match.index, palette: rule.palette };
    }
  }
  return best ? best.palette : null;
}

function estimatePartExtent(part: BlueprintPart): [number, number, number] {
  const [d0, d1, d2] = part.dimensions;
  if (part.primitive === 'box') return [d0, d1, d2];
  if (part.primitive === 'cylinder') {
    const r = Math.max(d0, d1);
    return [r * 2, d2, r * 2];
  }
  if (part.primitive === 'sphere') return [d0 * 2, d0 * 2, d0 * 2];
  if (part.primitive === 'cone') return [d0 * 2, d1, d0 * 2];
  return [(d0 + d1) * 2, (d0 + d1) * 2, d1 * 2];
}

export function computeBoundingBox(parts: BlueprintPart[]): { width: number; height: number; depth: number } {
  if (parts.length === 0) return { width: 1, height: 1, depth: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const part of parts) {
    const [ew, eh, ed] = estimatePartExtent(part);
    const [px, py, pz] = part.position;
    minX = Math.min(minX, px - ew / 2);
    maxX = Math.max(maxX, px + ew / 2);
    minY = Math.min(minY, py - eh / 2);
    maxY = Math.max(maxY, py + eh / 2);
    minZ = Math.min(minZ, pz - ed / 2);
    maxZ = Math.max(maxZ, pz + ed / 2);
  }

  return {
    width: Number(Math.max(0.2, maxX - minX).toFixed(2)),
    height: Number(Math.max(0.2, maxY - minY).toFixed(2)),
    depth: Number(Math.max(0.2, maxZ - minZ).toFixed(2)),
  };
}

function isValidHexColor(val: unknown): val is string {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val.trim());
}

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitize3DBlueprint(raw: unknown, prompt: string): Procedural3DBlueprint | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.parts) || obj.parts.length < 3) return null;

  const validPrimitives = new Set<PartPrimitive>(['box', 'cylinder', 'sphere', 'cone', 'torus']);
  const parts: BlueprintPart[] = [];

  for (let i = 0; i < Math.min(28, obj.parts.length); i++) {
    const item = obj.parts[i];
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const primitive = validPrimitives.has(r.primitive as PartPrimitive)
      ? (r.primitive as PartPrimitive)
      : 'box';
    const rawDims = Array.isArray(r.dimensions) ? r.dimensions : [1, 1, 1];
    const rawPos = Array.isArray(r.position) ? r.position : [0, 0.5, 0];
    const rawRot = Array.isArray(r.rotation) ? r.rotation : [0, 0, 0];

    const dims: [number, number, number] = [
      clampNum(rawDims[0], 0.03, 18, 0.5),
      clampNum(rawDims[1], 0.02, 18, 0.5),
      clampNum(rawDims[2], 0.03, 18, 0.5),
    ];
    const pos: [number, number, number] = [
      clampNum(rawPos[0], -15, 15, 0),
      clampNum(rawPos[1], -4, 18, 0.5),
      clampNum(rawPos[2], -15, 15, 0),
    ];
    const rot: [number, number, number] = [
      clampNum(rawRot[0], -Math.PI * 2, Math.PI * 2, 0),
      clampNum(rawRot[1], -Math.PI * 2, Math.PI * 2, 0),
      clampNum(rawRot[2], -Math.PI * 2, Math.PI * 2, 0),
    ];

    const role = r.role === 'primary' || r.role === 'secondary' || r.role === 'accent' ? r.role : 'secondary';
    const spinAxis = r.spinAxis === 'x' || r.spinAxis === 'y' || r.spinAxis === 'z' ? r.spinAxis : undefined;

    parts.push({
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 32) : `part-${i + 1}`,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : `Component ${i + 1}`,
      role,
      primitive,
      dimensions: dims,
      position: pos,
      rotation: rot,
      color: isValidHexColor(r.color) ? r.color.trim() : '#38bdf8',
      roughness: clampNum(r.roughness, 0.05, 1, 0.4),
      metalness: clampNum(r.metalness, 0, 1, 0.45),
      ...(typeof r.clearcoat === 'number' ? { clearcoat: clampNum(r.clearcoat, 0, 1, 0) } : {}),
      ...(isValidHexColor(r.emissive) ? { emissive: r.emissive.trim() } : {}),
      ...(spinAxis ? { spinAxis } : {}),
    });
  }

  if (parts.length < 3) return null;

  // Lift assembly cleanly above ground y = 0 if lowest vertex sits below 0
  let minY = Infinity;
  for (const part of parts) {
    const [, eh] = estimatePartExtent(part);
    minY = Math.min(minY, part.position[1] - eh / 2);
  }
  if (Number.isFinite(minY) && minY < 0) {
    const lift = Number((-minY).toFixed(3));
    for (const part of parts) {
      part.position[1] = Number((part.position[1] + lift).toFixed(3));
    }
  }

  return {
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 80) : prompt.slice(0, 60),
    category: typeof obj.category === 'string' && obj.category.trim() ? obj.category.trim().slice(0, 40) : 'Custom Synthesis',
    prompt,
    boundingBox: computeBoundingBox(parts),
    parts,
  };
}

export function sanitizeWorldBlueprint(raw: unknown, prompt: string): ProceduralWorldBlueprint | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.buildings) || obj.buildings.length < 3) return null;

  const validBiomes = new Set<WorldBiome>([
    'urban_campus',
    'desert_outpost',
    'alpine_research',
    'coastal_port',
    'mars_colony',
    'arctic_station',
    'cyber_metropolis',
  ]);
  const biome: WorldBiome = validBiomes.has(obj.biome as WorldBiome)
    ? (obj.biome as WorldBiome)
    : 'urban_campus';

  const buildings: WorldBuilding[] = [];
  for (let i = 0; i < Math.min(36, obj.buildings.length); i++) {
    const b = obj.buildings[i] as Record<string, unknown> | null;
    if (!b || typeof b !== 'object') continue;
    const roofType = b.roofType === 'spire' || b.roofType === 'dome' || b.roofType === 'flat' ? b.roofType : 'flat';
    const floors = Math.round(clampNum(b.floors, 1, 22, 4));
    buildings.push({
      id: typeof b.id === 'string' && b.id.trim() ? b.id.trim().slice(0, 24) : `bld-${i + 1}`,
      name: typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 40) : undefined,
      x: clampNum(b.x, -45, 45, (i - 4) * 5),
      z: clampNum(b.z, -45, 45, (i % 3) * 8),
      width: clampNum(b.width, 1.5, 16, 4),
      height: clampNum(b.height, 2, 36, floors * 2.2),
      depth: clampNum(b.depth, 1.5, 16, 4),
      floors,
      color: isValidHexColor(b.color) ? b.color.trim() : '#334155',
      roofType,
    });
  }
  if (buildings.length < 3) return null;

  const rawActors = Array.isArray(obj.actors) ? obj.actors : [];
  const actors: WorldAgentActor[] = [];
  for (let i = 0; i < Math.min(8, rawActors.length); i++) {
    const a = rawActors[i] as Record<string, unknown> | null;
    if (!a || typeof a !== 'object') continue;
    actors.push({
      id: typeof a.id === 'string' && a.id.trim() ? a.id.trim().slice(0, 24) : `actor-${i + 1}`,
      name: typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 40) : `Autonomous Unit ${i + 1}`,
      x: clampNum(a.x, -30, 30, -6 + i * 5),
      z: clampNum(a.z, -30, 30, 2 + i * 3),
      speed: clampNum(a.speed, 0.5, 8, 2),
      heading: clampNum(a.heading, -Math.PI * 2, Math.PI * 2, i),
      color: isValidHexColor(a.color) ? a.color.trim() : '#38bdf8',
    });
  }
  if (actors.length < 3) {
    while (actors.length < 3) {
      const idx = actors.length + 1;
      actors.push({
        id: `actor-${idx}`,
        name: `Autonomous Unit 0${idx}`,
        x: -6 + idx * 4,
        z: idx * 2,
        speed: 1.8 + idx * 0.3,
        heading: idx * 1.1,
        color: idx === 1 ? '#38bdf8' : idx === 2 ? '#f59e0b' : '#10b981',
      });
    }
  }

  const rawTrees = Array.isArray(obj.treePositions) ? obj.treePositions : [];
  const treePositions = rawTrees.slice(0, 48).map((t) => {
    const tr = (t || {}) as Record<string, unknown>;
    return {
      x: clampNum(tr.x, -45, 45, 12),
      z: clampNum(tr.z, -45, 45, 12),
      scale: clampNum(tr.scale, 0.5, 2.2, 1),
    };
  });

  const timeOfDay = obj.timeOfDay === 'day' || obj.timeOfDay === 'dusk' || obj.timeOfDay === 'night' ? obj.timeOfDay : 'day';

  return {
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 80) : prompt.slice(0, 60),
    biome,
    prompt,
    skyColor: isValidHexColor(obj.skyColor) ? obj.skyColor.trim() : '#0f172a',
    fogColor: isValidHexColor(obj.fogColor) ? obj.fogColor.trim() : '#0f172a',
    terrainColor: isValidHexColor(obj.terrainColor) ? obj.terrainColor.trim() : '#1e293b',
    waterColor: isValidHexColor(obj.waterColor) ? obj.waterColor.trim() : '#0284c7',
    foliageColor: isValidHexColor(obj.foliageColor) ? obj.foliageColor.trim() : '#15803d',
    accentColor: isValidHexColor(obj.accentColor) ? obj.accentColor.trim() : '#38bdf8',
    waterLevel: clampNum(obj.waterLevel, -5, 4, -1.2),
    gravity: clampNum(obj.gravity, 0.5, 25, 9.81),
    timeOfDay,
    terrainAmplitude: clampNum(obj.terrainAmplitude, 0, 12, 1.2),
    features: Array.isArray(obj.features) ? obj.features.map((f) => String(f)).slice(0, 10) : [],
    buildings,
    roadControlPoints: [[-45, 0], [-15, 0], [0, 0], [15, 0], [45, 0]],
    treePositions,
    actors,
  };
}

function scaleBlueprint(parts: BlueprintPart[], scale: number): BlueprintPart[] {
  if (scale === 1) return parts;
  return parts.map((pt) => ({
    ...pt,
    dimensions: [
      Number((pt.dimensions[0] * scale).toFixed(3)),
      Number((pt.dimensions[1] * scale).toFixed(3)),
      Number((pt.dimensions[2] * scale).toFixed(3)),
    ],
    position: [
      Number((pt.position[0] * scale).toFixed(3)),
      Number((pt.position[1] * scale).toFixed(3)),
      Number((pt.position[2] * scale).toFixed(3)),
    ],
  }));
}

function makeTitleFromPrompt(prompt: string, fallback: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  if (!cleaned) return fallback;
  return cleaned.length <= 48 ? cleaned : `${cleaned.slice(0, 45)}...`;
}

export function generate3DBlueprint(prompt: string): Procedural3DBlueprint {
  const p = prompt.toLowerCase();
  const colorChoice = extractColorFromPrompt(prompt);
  const isLarge = /\b(giant|huge|large|tall|mega)\b|ضخم|كبير|عملاق|طويل/.test(p);
  const isSmall = /\b(mini|small|compact|tiny)\b|صغير|مصغر/.test(p);
  const scale = isLarge ? 1.3 : isSmall ? 0.78 : 1;

  // 1. Sports Car / Vehicle
  if (/\b(car|vehicle|sports|automobile|sedan|coupe|truck|suv)\b|سيارة|مركبة|شاحنة/.test(p)) {
    const paint = colorChoice?.primary ?? '#0284c7';
    const accent = colorChoice?.accent ?? '#38bdf8';
    const parts = scaleBlueprint([
      { id: 'chassis', name: 'Lower Aero Chassis', role: 'primary', primitive: 'box', dimensions: [1.95, 0.42, 4.2], position: [0, 0.48, 0], rotation: [0, 0, 0], color: paint, roughness: 0.22, metalness: 0.75, clearcoat: 1.0 },
      { id: 'splitter', name: 'Front Carbon Splitter', role: 'accent', primitive: 'box', dimensions: [1.98, 0.08, 0.65], position: [0, 0.24, 1.95], rotation: [0, 0, 0], color: '#1e293b', roughness: 0.65, metalness: 0.2 },
      { id: 'cabin', name: 'Glass Canopy Cabin', role: 'secondary', primitive: 'box', dimensions: [1.55, 0.46, 2.05], position: [0, 0.9, -0.15], rotation: [0, 0, 0], color: '#0f172a', roughness: 0.08, metalness: 0.15, clearcoat: 1.0 },
      { id: 'spoiler_wing', name: 'Rear Downforce Wing', role: 'secondary', primitive: 'box', dimensions: [1.92, 0.07, 0.36], position: [0, 0.98, -1.95], rotation: [-0.12, 0, 0], color: '#0f172a', roughness: 0.55, metalness: 0.35 },
      { id: 'wheel_fl', name: 'Front-Left Wheel', role: 'secondary', primitive: 'cylinder', dimensions: [0.36, 0.36, 0.26], position: [-0.95, 0.36, 1.32], rotation: [0, 0, Math.PI / 2], color: '#18181b', roughness: 0.82, metalness: 0.08 },
      { id: 'wheel_fr', name: 'Front-Right Wheel', role: 'secondary', primitive: 'cylinder', dimensions: [0.36, 0.36, 0.26], position: [0.95, 0.36, 1.32], rotation: [0, 0, Math.PI / 2], color: '#18181b', roughness: 0.82, metalness: 0.08 },
      { id: 'wheel_rl', name: 'Rear-Left Wheel', role: 'secondary', primitive: 'cylinder', dimensions: [0.38, 0.38, 0.3], position: [-0.96, 0.38, -1.3], rotation: [0, 0, Math.PI / 2], color: '#18181b', roughness: 0.82, metalness: 0.08 },
      { id: 'wheel_rr', name: 'Rear-Right Wheel', role: 'secondary', primitive: 'cylinder', dimensions: [0.38, 0.38, 0.3], position: [0.96, 0.38, -1.3], rotation: [0, 0, Math.PI / 2], color: '#18181b', roughness: 0.82, metalness: 0.08 },
      { id: 'headlight_l', name: 'LED Headlight Bar L', role: 'accent', primitive: 'box', dimensions: [0.42, 0.08, 0.1], position: [-0.68, 0.56, 2.08], rotation: [0, 0, 0], color: '#e0f2fe', roughness: 0.1, metalness: 0.1, emissive: accent },
      { id: 'headlight_r', name: 'LED Headlight Bar R', role: 'accent', primitive: 'box', dimensions: [0.42, 0.08, 0.1], position: [0.68, 0.56, 2.08], rotation: [0, 0, 0], color: '#e0f2fe', roughness: 0.1, metalness: 0.1, emissive: accent },
    ], scale);
    return {
      title: `${colorChoice ? `${colorChoice.label} ` : ''}Aero-GT Sports Coupe`,
      category: 'Automotive',
      prompt,
      boundingBox: computeBoundingBox(parts),
      parts,
    };
  }

  // 2. Drone / Quadcopter
  if (/\b(drone|uav|quad|quadcopter|helicopter)\b|طائرة مسيرة|درون|مروحية/.test(p)) {
    const hullColor = colorChoice?.primary ?? '#334155';
    const rotorColor = colorChoice?.accent ?? '#38bdf8';
    const parts = scaleBlueprint([
      { id: 'core', name: 'Avionics Central Hull', role: 'primary', primitive: 'box', dimensions: [0.75, 0.28, 1.05], position: [0, 0.42, 0], rotation: [0, 0, 0], color: hullColor, roughness: 0.35, metalness: 0.72 },
      { id: 'sensor_pod', name: 'Gimbal LiDAR Pod', role: 'accent', primitive: 'sphere', dimensions: [0.22, 24, 16], position: [0, 0.24, 0.35], rotation: [0, 0, 0], color: '#0f172a', roughness: 0.15, metalness: 0.85 },
      { id: 'arm_fl', name: 'Carbon Boom FL', role: 'secondary', primitive: 'box', dimensions: [0.1, 0.08, 1.25], position: [-0.55, 0.44, 0.55], rotation: [0, -Math.PI / 4, 0], color: '#1e293b', roughness: 0.65, metalness: 0.25 },
      { id: 'arm_fr', name: 'Carbon Boom FR', role: 'secondary', primitive: 'box', dimensions: [0.1, 0.08, 1.25], position: [0.55, 0.44, 0.55], rotation: [0, Math.PI / 4, 0], color: '#1e293b', roughness: 0.65, metalness: 0.25 },
      { id: 'arm_rl', name: 'Carbon Boom RL', role: 'secondary', primitive: 'box', dimensions: [0.1, 0.08, 1.25], position: [-0.55, 0.44, -0.55], rotation: [0, Math.PI / 4, 0], color: '#1e293b', roughness: 0.65, metalness: 0.25 },
      { id: 'arm_rr', name: 'Carbon Boom RR', role: 'secondary', primitive: 'box', dimensions: [0.1, 0.08, 1.25], position: [0.55, 0.44, -0.55], rotation: [0, -Math.PI / 4, 0], color: '#1e293b', roughness: 0.65, metalness: 0.25 },
      { id: 'rotor_fl', name: 'Rotor Ring FL', role: 'accent', primitive: 'torus', dimensions: [0.36, 0.035, 16], position: [-0.95, 0.52, 0.95], rotation: [Math.PI / 2, 0, 0], color: rotorColor, roughness: 0.25, metalness: 0.6, emissive: rotorColor, spinAxis: 'z' },
      { id: 'rotor_fr', name: 'Rotor Ring FR', role: 'accent', primitive: 'torus', dimensions: [0.36, 0.035, 16], position: [0.95, 0.52, 0.95], rotation: [Math.PI / 2, 0, 0], color: rotorColor, roughness: 0.25, metalness: 0.6, emissive: rotorColor, spinAxis: 'z' },
      { id: 'rotor_rl', name: 'Rotor Ring RL', role: 'accent', primitive: 'torus', dimensions: [0.36, 0.035, 16], position: [-0.95, 0.52, -0.95], rotation: [Math.PI / 2, 0, 0], color: '#f59e0b', roughness: 0.25, metalness: 0.6, spinAxis: 'z' },
      { id: 'rotor_rr', name: 'Rotor Ring RR', role: 'accent', primitive: 'torus', dimensions: [0.36, 0.035, 16], position: [0.95, 0.52, -0.95], rotation: [Math.PI / 2, 0, 0], color: '#f59e0b', roughness: 0.25, metalness: 0.6, spinAxis: 'z' },
    ], scale);
    return {
      title: `${colorChoice ? `${colorChoice.label} ` : ''}Autonomous Survey Quadrotor`,
      category: 'Aerospace',
      prompt,
      boundingBox: computeBoundingBox(parts),
      parts,
    };
  }

  // 3. Rocket / Spaceship / Satellite
  if (/\b(rocket|spaceship|spacecraft|shuttle|satellite|starship)\b|صاروخ|سفينة فضاء|مركبة فضائية|قمر صناعي/.test(p)) {
    const body = colorChoice?.primary ?? '#f1f5f9';
    const accent = colorChoice?.accent ?? '#ef4444';
    const parts = scaleBlueprint([
      { id: 'launch_pad', name: 'Launch Ring Pedestal', role: 'secondary', primitive: 'cylinder', dimensions: [1.1, 1.35, 0.24], position: [0, 0.12, 0], rotation: [0, 0, 0], color: '#334155', roughness: 0.7, metalness: 0.5 },
      { id: 'booster_core', name: 'Main Propellant Fuselage', role: 'primary', primitive: 'cylinder', dimensions: [0.46, 0.52, 2.8], position: [0, 1.75, 0], rotation: [0, 0, 0], color: body, roughness: 0.28, metalness: 0.65, clearcoat: 0.6 },
      { id: 'nose_cone', name: 'Aerodynamic Payload Fairing', role: 'primary', primitive: 'cone', dimensions: [0.47, 1.05, 24], position: [0, 3.67, 0], rotation: [0, 0, 0], color: accent, roughness: 0.25, metalness: 0.55 },
      { id: 'viewport', name: 'Flight Deck Viewport', role: 'accent', primitive: 'sphere', dimensions: [0.18, 16, 12], position: [0, 2.75, 0.42], rotation: [0, 0, 0], color: '#38bdf8', roughness: 0.08, metalness: 0.2, emissive: '#0284c7' },
      { id: 'engine_bell', name: 'Main Thruster Nozzle', role: 'secondary', primitive: 'cone', dimensions: [0.38, 0.52, 20], position: [0, 0.42, 0], rotation: [0, 0, 0], color: '#1e293b', roughness: 0.4, metalness: 0.88 },
      { id: 'fin_n', name: 'Stabilizer Fin North', role: 'accent', primitive: 'box', dimensions: [0.08, 0.85, 0.55], position: [0, 0.8, 0.65], rotation: [0.22, 0, 0], color: accent, roughness: 0.35, metalness: 0.5 },
      { id: 'fin_s', name: 'Stabilizer Fin South', role: 'accent', primitive: 'box', dimensions: [0.08, 0.85, 0.55], position: [0, 0.8, -0.65], rotation: [-0.22, 0, 0], color: accent, roughness: 0.35, metalness: 0.5 },
      { id: 'fin_e', name: 'Stabilizer Fin East', role: 'accent', primitive: 'box', dimensions: [0.55, 0.85, 0.08], position: [0.65, 0.8, 0], rotation: [0, 0, -0.22], color: accent, roughness: 0.35, metalness: 0.5 },
      { id: 'fin_w', name: 'Stabilizer Fin West', role: 'accent', primitive: 'box', dimensions: [0.55, 0.85, 0.08], position: [-0.65, 0.8, 0], rotation: [0, 0, 0.22], color: accent, roughness: 0.35, metalness: 0.5 },
      { id: 'ring_collar', name: 'Interstage Orbital Ring', role: 'secondary', primitive: 'torus', dimensions: [0.52, 0.05, 16], position: [0, 2.45, 0], rotation: [Math.PI / 2, 0, 0], color: '#fbbf24', roughness: 0.3, metalness: 0.85, spinAxis: 'z' },
    ], scale);
    return {
      title: `${colorChoice ? `${colorChoice.label} ` : ''}Orbital Launch Spacecraft`,
      category: 'Spacecraft Engineering',
      prompt,
      boundingBox: computeBoundingBox(parts),
      parts,
    };
  }

  // 4. House / Villa / Architectural Building
  if (/\b(house|home|villa|cabin|building|mansion|cottage|skyscraper|tower)\b|منزل|بيت|فيلا|مبنى|برج|عمارة/.test(p)) {
    const isTower = /\b(skyscraper|tower)\b|برج|ناطحات/.test(p);
    const wallColor = colorChoice?.primary ?? '#e2e8f0';
    const roofColor = /blue|أزرق/.test(p) ? '#1d4ed8' : /red|أحمر/.test(p) ? '#b91c1c' : colorChoice?.secondary ?? '#334155';
    const parts = isTower
      ? scaleBlueprint([
          { id: 'plaza', name: 'Granite Podium Plinth', role: 'secondary', primitive: 'box', dimensions: [3.2, 0.28, 3.2], position: [0, 0.14, 0], rotation: [0, 0, 0], color: '#334155', roughness: 0.7, metalness: 0.2 },
          { id: 'lower_tier', name: 'Lower Atrium Volume', role: 'primary', primitive: 'box', dimensions: [2.2, 1.8, 2.2], position: [0, 1.18, 0], rotation: [0, 0, 0], color: wallColor, roughness: 0.2, metalness: 0.5 },
          { id: 'mid_tier', name: 'Mid Structural Core', role: 'primary', primitive: 'box', dimensions: [1.65, 2.0, 1.65], position: [0, 3.08, 0], rotation: [0, 0, 0], color: wallColor, roughness: 0.18, metalness: 0.55 },
          { id: 'upper_tier', name: 'Observatory Crown Tier', role: 'secondary', primitive: 'box', dimensions: [1.1, 1.1, 1.1], position: [0, 4.63, 0], rotation: [0, Math.PI / 4, 0], color: roofColor, roughness: 0.15, metalness: 0.65 },
          { id: 'spire', name: 'Telemetry Spire Mast', role: 'accent', primitive: 'cone', dimensions: [0.22, 1.35, 16], position: [0, 5.85, 0], rotation: [0, 0, 0], color: '#38bdf8', roughness: 0.2, metalness: 0.85, emissive: '#0284c7' },
          { id: 'beacon', name: 'Aviation Warning Beacon', role: 'accent', primitive: 'sphere', dimensions: [0.1, 12, 10], position: [0, 6.55, 0], rotation: [0, 0, 0], color: '#f59e0b', roughness: 0.1, metalness: 0.2, emissive: '#f59e0b' },
        ], scale)
      : scaleBlueprint([
          { id: 'foundation', name: 'Architectural Terrace Base', role: 'secondary', primitive: 'box', dimensions: [3.8, 0.22, 3.2], position: [0, 0.11, 0], rotation: [0, 0, 0], color: '#475569', roughness: 0.85, metalness: 0.1 },
          { id: 'main_volume', name: 'Main Living Structure', role: 'primary', primitive: 'box', dimensions: [3.1, 1.5, 2.4], position: [0, 0.97, 0], rotation: [0, 0, 0], color: wallColor, roughness: 0.6, metalness: 0.12 },
          { id: 'upper_wing', name: 'Second Story Cantilever', role: 'primary', primitive: 'box', dimensions: [2.1, 1.05, 1.8], position: [-0.35, 2.24, -0.1], rotation: [0, 0, 0], color: wallColor, roughness: 0.55, metalness: 0.15 },
          { id: 'pitched_roof', name: 'Architectural Roof Canopy', role: 'secondary', primitive: 'cone', dimensions: [1.65, 0.85, 4], position: [-0.35, 3.18, -0.1], rotation: [0, Math.PI / 4, 0], color: roofColor, roughness: 0.45, metalness: 0.35 },
          { id: 'glass_facade', name: 'Panoramic Glass Curtain', role: 'accent', primitive: 'box', dimensions: [1.6, 1.05, 0.08], position: [0.4, 0.95, 1.22], rotation: [0, 0, 0], color: '#38bdf8', roughness: 0.08, metalness: 0.25, clearcoat: 1.0, emissive: '#0369a1' },
          { id: 'entry_door', name: 'Timber Pivot Entrance', role: 'accent', primitive: 'box', dimensions: [0.55, 1.05, 0.1], position: [-0.9, 0.74, 1.21], rotation: [0, 0, 0], color: '#92400e', roughness: 0.55, metalness: 0.1 },
          { id: 'solar_panel', name: 'Rooftop Solar Array', role: 'accent', primitive: 'box', dimensions: [1.1, 0.06, 0.9], position: [0.95, 1.82, 0.1], rotation: [0.2, 0, 0], color: '#0f172a', roughness: 0.15, metalness: 0.75, clearcoat: 0.9 },
          { id: 'column_1', name: 'Porch Support Column L', role: 'secondary', primitive: 'cylinder', dimensions: [0.09, 0.09, 1.5], position: [1.35, 0.97, 1.15], rotation: [0, 0, 0], color: '#cbd5e1', roughness: 0.4, metalness: 0.4 },
        ], scale);
    return {
      title: makeTitleFromPrompt(prompt, isTower ? 'Architectural Spire Tower' : 'Modern Solar Villa'),
      category: 'Architecture',
      prompt,
      boundingBox: computeBoundingBox(parts),
      parts,
    };
  }

  // 5. Castle / Fortress / Pyramid
  if (/\b(castle|fortress|palace|citadel|pyramid)\b|قلعة|حصن|قصر|هرم/.test(p)) {
    const isPyramid = /\bpyramid\b|هرم/.test(p);
    const stone = colorChoice?.primary ?? (isPyramid ? '#d97706' : '#64748b');
    const accent = colorChoice?.accent ?? '#f59e0b';
    const parts = isPyramid
      ? scaleBlueprint([
          { id: 'base_plinth', name: 'Desert Stone Plinth', role: 'secondary', primitive: 'box', dimensions: [3.8, 0.22, 3.8], position: [0, 0.11, 0], rotation: [0, 0, 0], color: '#92400e', roughness: 0.9, metalness: 0.05 },
          { id: 'pyramid_core', name: 'Stepped Limestone Pyramid', role: 'primary', primitive: 'cone', dimensions: [2.4, 2.7, 4], position: [0, 1.57, 0], rotation: [0, Math.PI / 4, 0], color: stone, roughness: 0.78, metalness: 0.08 },
          { id: 'capstone', name: 'Golden Pyramidion Capstone', role: 'accent', primitive: 'cone', dimensions: [0.46, 0.55, 4], position: [0, 2.95, 0], rotation: [0, Math.PI / 4, 0], color: '#fbbf24', roughness: 0.18, metalness: 0.92, emissive: '#b45309' },
          { id: 'portal', name: 'Sanctum Entrance Gate', role: 'secondary', primitive: 'box', dimensions: [0.7, 0.85, 0.4], position: [0, 0.55, 1.45], rotation: [0, 0, 0], color: '#1e293b', roughness: 0.6, metalness: 0.3 },
        ], scale)
      : scaleBlueprint([
          { id: 'keep', name: 'Central Citadel Keep', role: 'primary', primitive: 'box', dimensions: [2.0, 2.1, 2.0], position: [0, 1.05, 0], rotation: [0, 0, 0], color: stone, roughness: 0.82, metalness: 0.1 },
          { id: 'tower_fl', name: 'Bastion Turret FL', role: 'secondary', primitive: 'cylinder', dimensions: [0.42, 0.46, 2.6], position: [-1.25, 1.3, 1.25], rotation: [0, 0, 0], color: stone, roughness: 0.8, metalness: 0.1 },
          { id: 'tower_fr', name: 'Bastion Turret FR', role: 'secondary', primitive: 'cylinder', dimensions: [0.42, 0.46, 2.6], position: [1.25, 1.3, 1.25], rotation: [0, 0, 0], color: stone, roughness: 0.8, metalness: 0.1 },
          { id: 'tower_rl', name: 'Bastion Turret RL', role: 'secondary', primitive: 'cylinder', dimensions: [0.42, 0.46, 2.6], position: [-1.25, 1.3, -1.25], rotation: [0, 0, 0], color: stone, roughness: 0.8, metalness: 0.1 },
          { id: 'tower_rr', name: 'Bastion Turret RR', role: 'secondary', primitive: 'cylinder', dimensions: [0.42, 0.46, 2.6], position: [1.25, 1.3, -1.25], rotation: [0, 0, 0], color: stone, roughness: 0.8, metalness: 0.1 },
          { id: 'spire_fl', name: 'Conical Spire FL', role: 'accent', primitive: 'cone', dimensions: [0.52, 0.9, 16], position: [-1.25, 3.05, 1.25], rotation: [0, 0, 0], color: accent, roughness: 0.45, metalness: 0.35 },
          { id: 'spire_fr', name: 'Conical Spire FR', role: 'accent', primitive: 'cone', dimensions: [0.52, 0.9, 16], position: [1.25, 3.05, 1.25], rotation: [0, 0, 0], color: accent, roughness: 0.45, metalness: 0.35 },
          { id: 'gate', name: 'Arched Portcullis Gate', role: 'accent', primitive: 'box', dimensions: [0.75, 1.05, 0.25], position: [0, 0.55, 1.05], rotation: [0, 0, 0], color: '#78350f', roughness: 0.7, metalness: 0.25 },
        ], scale);
    return {
      title: makeTitleFromPrompt(prompt, isPyramid ? 'Monumental Pyramid' : 'Bastion Fortress'),
      category: 'Monumental Architecture',
      prompt,
      boundingBox: computeBoundingBox(parts),
      parts,
    };
  }

  // 6. Bridge / Viaduct
  if (/\b(bridge|viaduct|overpass)\b|جسر|كوبري/.test(p)) {
    const steel = colorChoice?.primary ?? '#dc2626';
    const parts = scaleBlueprint([
      { id: 'deck', name: 'Suspended Roadway Deck', role: 'primary', primitive: 'box', dimensions: [5.6, 0.22, 1.5], position: [0, 1.15, 0], rotation: [0, 0, 0], color: '#334155', roughness: 0.7, metalness: 0.3 },
      { id: 'pylon_l', name: 'Suspension Tower West', role: 'primary', primitive: 'box', dimensions: [0.35, 3.1, 1.25], position: [-1.6, 1.55, 0], rotation: [0, 0, 0], color: steel, roughness: 0.35, metalness: 0.75 },
      { id: 'pylon_r', name: 'Suspension Tower East', role: 'primary', primitive: 'box', dimensions: [0.35, 3.1, 1.25], position: [1.6, 1.55, 0], rotation: [0, 0, 0], color: steel, roughness: 0.35, metalness: 0.75 },
      { id: 'pier_l', name: 'Submerged Caisson West', role: 'secondary', primitive: 'cylinder', dimensions: [0.48, 0.56, 0.8], position: [-1.6, 0.4, 0], rotation: [0, 0, 0], color: '#475569', roughness: 0.85, metalness: 0.1 },
      { id: 'pier_r', name: 'Submerged Caisson East', role: 'secondary', primitive: 'cylinder', dimensions: [0.48, 0.56, 0.8], position: [1.6, 0.4, 0], rotation: [0, 0, 0], color: '#475569', roughness: 0.85, metalness: 0.1 },
      { id: 'cable_f', name: 'Main Suspension Cable Front', role: 'accent', primitive: 'cylinder', dimensions: [0.04, 0.04, 5.2], position: [0, 2.25, 0.55], rotation: [0, 0, Math.PI / 2], color: '#cbd5e1', roughness: 0.3, metalness: 0.85 },
      { id: 'cable_b', name: 'Main Suspension Cable Back', role: 'accent', primitive: 'cylinder', dimensions: [0.04, 0.04, 5.2], position: [0, 2.25, -0.55], rotation: [0, 0, Math.PI / 2], color: '#cbd5e1', roughness: 0.3, metalness: 0.85 },
    ], scale);
    return {
      title: makeTitleFromPrompt(prompt, 'Cable-Stayed Suspension Bridge'),
      category: 'Civil Engineering',
      prompt,
      boundingBox: computeBoundingBox(parts),
      parts,
    };
  }

  // 7. Ship / Boat / Submarine
  if (/\b(ship|boat|yacht|vessel|submarine)\b|سفينة|قارب|غواصة|يخت/.test(p)) {
    const isSub = /\bsubmarine\b|غواصة/.test(p);
    const hull = colorChoice?.primary ?? (isSub ? '#1e293b' : '#f8fafc');
    const accent = colorChoice?.accent ?? '#0ea5e9';
    const parts = isSub
      ? scaleBlueprint([
          { id: 'hull', name: 'Pressure Hull Cylinder', role: 'primary', primitive: 'cylinder', dimensions: [0.55, 0.55, 3.8], position: [0, 0.65, 0], rotation: [Math.PI / 2, 0, 0], color: hull, roughness: 0.35, metalness: 0.78 },
          { id: 'bow', name: 'Hydrodynamic Sonar Bow', role: 'primary', primitive: 'sphere', dimensions: [0.55, 24, 16], position: [0, 0.65, 1.9], rotation: [0, 0, 0], color: hull, roughness: 0.35, metalness: 0.78 },
          { id: 'sail', name: 'Conning Tower Sail', role: 'secondary', primitive: 'box', dimensions: [0.36, 0.85, 1.05], position: [0, 1.38, 0.3], rotation: [0, 0, 0], color: '#334155', roughness: 0.4, metalness: 0.75 },
          { id: 'periscope', name: 'Optical Mast', role: 'accent', primitive: 'cylinder', dimensions: [0.05, 0.05, 0.65], position: [0, 2.05, 0.4], rotation: [0, 0, 0], color: accent, roughness: 0.2, metalness: 0.9 },
          { id: 'propeller', name: 'Skewed Stern Propeller', role: 'accent', primitive: 'torus', dimensions: [0.34, 0.06, 12], position: [0, 0.65, -2.05], rotation: [0, 0, 0], color: '#fbbf24', roughness: 0.25, metalness: 0.9, spinAxis: 'z' },
        ], scale)
      : scaleBlueprint([
          { id: 'hull', name: 'Marine Displacement Hull', role: 'primary', primitive: 'box', dimensions: [1.35, 0.58, 4.1], position: [0, 0.36, 0], rotation: [0, 0, 0], color: hull, roughness: 0.3, metalness: 0.45, clearcoat: 0.8 },
          { id: 'bow', name: 'Forward Bow Prow', role: 'primary', primitive: 'cone', dimensions: [0.68, 1.15, 4], position: [0, 0.42, 2.55], rotation: [Math.PI / 2, Math.PI / 4, 0], color: hull, roughness: 0.3, metalness: 0.45 },
          { id: 'deck', name: 'Teak Sun Deck', role: 'secondary', primitive: 'box', dimensions: [1.22, 0.08, 3.6], position: [0, 0.68, -0.05], rotation: [0, 0, 0], color: '#b45309', roughness: 0.7, metalness: 0.05 },
          { id: 'bridge', name: 'Panoramic Helm Cabin', role: 'secondary', primitive: 'box', dimensions: [0.95, 0.58, 1.65], position: [0, 1.0, -0.25], rotation: [0, 0, 0], color: '#0f172a', roughness: 0.12, metalness: 0.25, clearcoat: 1.0 },
          { id: 'radar_mast', name: 'Navigational Radar Arch', role: 'accent', primitive: 'torus', dimensions: [0.46, 0.05, 12], position: [0, 1.55, -0.55], rotation: [0, 0, 0], color: accent, roughness: 0.25, metalness: 0.75 },
        ], scale);
    return {
      title: makeTitleFromPrompt(prompt, isSub ? 'Deep-Sea Autonomous Submarine' : 'Oceanic Research Vessel'),
      category: 'Marine Engineering',
      prompt,
      boundingBox: computeBoundingBox(parts),
      parts,
    };
  }

  // 8. Furniture (Chair / Table / Desk)
  if (/\b(chair|table|desk|bench|stool)\b|كرسي|طاولة|مكتب/.test(p)) {
    const isTable = /\b(table|desk)\b|طاولة|مكتب/.test(p);
    const matColor = colorChoice?.primary ?? '#92400e';
    const frameColor = colorChoice?.secondary ?? '#1e293b';
    const parts = isTable
      ? scaleBlueprint([
          { id: 'tabletop', name: 'Precision Laminated Tabletop', role: 'primary', primitive: 'box', dimensions: [2.8, 0.12, 1.5], position: [0, 1.06, 0], rotation: [0, 0, 0], color: matColor, roughness: 0.42, metalness: 0.15, clearcoat: 0.4 },
          { id: 'leg_fl', name: 'Steel Leg FL', role: 'secondary', primitive: 'cylinder', dimensions: [0.06, 0.05, 1.0], position: [-1.2, 0.5, 0.6], rotation: [0, 0, 0], color: frameColor, roughness: 0.35, metalness: 0.8 },
          { id: 'leg_fr', name: 'Steel Leg FR', role: 'secondary', primitive: 'cylinder', dimensions: [0.06, 0.05, 1.0], position: [1.2, 0.5, 0.6], rotation: [0, 0, 0], color: frameColor, roughness: 0.35, metalness: 0.8 },
          { id: 'leg_rl', name: 'Steel Leg RL', role: 'secondary', primitive: 'cylinder', dimensions: [0.06, 0.05, 1.0], position: [-1.2, 0.5, -0.6], rotation: [0, 0, 0], color: frameColor, roughness: 0.35, metalness: 0.8 },
          { id: 'leg_rr', name: 'Steel Leg RR', role: 'secondary', primitive: 'cylinder', dimensions: [0.06, 0.05, 1.0], position: [1.2, 0.5, -0.6], rotation: [0, 0, 0], color: frameColor, roughness: 0.35, metalness: 0.8 },
          { id: 'crossbar', name: 'Structural Crossbrace', role: 'accent', primitive: 'box', dimensions: [2.4, 0.06, 0.08], position: [0, 0.35, 0], rotation: [0, 0, 0], color: frameColor, roughness: 0.4, metalness: 0.8 },
        ], scale)
      : scaleBlueprint([
          { id: 'seat', name: 'Ergonomic Contoured Seat', role: 'primary', primitive: 'box', dimensions: [1.05, 0.12, 1.05], position: [0, 0.82, 0], rotation: [0, 0, 0], color: matColor, roughness: 0.5, metalness: 0.15 },
          { id: 'backrest', name: 'Lumbar Backrest Frame', role: 'primary', primitive: 'box', dimensions: [1.02, 1.1, 0.12], position: [0, 1.4, -0.46], rotation: [-0.08, 0, 0], color: matColor, roughness: 0.5, metalness: 0.15 },
          { id: 'leg_fl', name: 'Front Leg L', role: 'secondary', primitive: 'cylinder', dimensions: [0.05, 0.04, 0.78], position: [-0.42, 0.39, 0.42], rotation: [0, 0, 0], color: frameColor, roughness: 0.35, metalness: 0.75 },
          { id: 'leg_fr', name: 'Front Leg R', role: 'secondary', primitive: 'cylinder', dimensions: [0.05, 0.04, 0.78], position: [0.42, 0.39, 0.42], rotation: [0, 0, 0], color: frameColor, roughness: 0.35, metalness: 0.75 },
          { id: 'leg_rl', name: 'Rear Leg L', role: 'secondary', primitive: 'cylinder', dimensions: [0.05, 0.04, 0.78], position: [-0.42, 0.39, -0.42], rotation: [0, 0, 0], color: frameColor, roughness: 0.35, metalness: 0.75 },
          { id: 'leg_rr', name: 'Rear Leg R', role: 'secondary', primitive: 'cylinder', dimensions: [0.05, 0.04, 0.78], position: [0.42, 0.39, -0.42], rotation: [0, 0, 0], color: frameColor, roughness: 0.35, metalness: 0.75 },
        ], scale);
    return {
      title: makeTitleFromPrompt(prompt, isTable ? 'Studio Work Table' : 'Architectural Lounge Chair'),
      category: 'Industrial Design',
      prompt,
      boundingBox: computeBoundingBox(parts),
      parts,
    };
  }

  // 9. Wind Turbine / Energy Rig
  if (/\b(turbine|wind|windmill|generator|energy)\b|توربين|طاقة/.test(p)) {
    const mastColor = colorChoice?.primary ?? '#e2e8f0';
    const accent = colorChoice?.accent ?? '#0ea5e9';
    const parts = scaleBlueprint([
      { id: 'pedestal', name: 'Concrete Foundation Base', role: 'primary', primitive: 'cylinder', dimensions: [0.85, 1.05, 0.45], position: [0, 0.225, 0], rotation: [0, 0, 0], color: '#475569', roughness: 0.85, metalness: 0.05 },
      { id: 'mast', name: 'Tapered Steel Mast', role: 'primary', primitive: 'cylinder', dimensions: [0.18, 0.34, 3.2], position: [0, 2.05, 0], rotation: [0, 0, 0], color: mastColor, roughness: 0.32, metalness: 0.55 },
      { id: 'nacelle', name: 'Generator Nacelle', role: 'secondary', primitive: 'box', dimensions: [0.56, 0.52, 1.15], position: [0, 3.72, -0.1], rotation: [0, 0, 0], color: '#f8fafc', roughness: 0.28, metalness: 0.45 },
      { id: 'hub', name: 'Aerodynamic Rotor Hub', role: 'accent', primitive: 'cone', dimensions: [0.24, 0.48, 20], position: [0, 3.72, 0.65], rotation: [Math.PI / 2, 0, 0], color: accent, roughness: 0.2, metalness: 0.7 },
      { id: 'blade_1', name: 'Composite Blade 1', role: 'secondary', primitive: 'box', dimensions: [0.14, 1.65, 0.04], position: [0, 4.55, 0.55], rotation: [0, 0, 0], color: '#cbd5e1', roughness: 0.24, metalness: 0.3 },
      { id: 'blade_2', name: 'Composite Blade 2', role: 'secondary', primitive: 'box', dimensions: [0.14, 1.65, 0.04], position: [-0.72, 3.3, 0.55], rotation: [0, 0, (2 * Math.PI) / 3], color: '#cbd5e1', roughness: 0.24, metalness: 0.3 },
      { id: 'blade_3', name: 'Composite Blade 3', role: 'secondary', primitive: 'box', dimensions: [0.14, 1.65, 0.04], position: [0.72, 3.3, 0.55], rotation: [0, 0, (-2 * Math.PI) / 3], color: '#cbd5e1', roughness: 0.24, metalness: 0.3 },
    ], scale);
    return {
      title: 'Offshore HAWT Energy Turbine',
      category: 'Energy Engineering',
      prompt,
      boundingBox: computeBoundingBox(parts),
      parts,
    };
  }

  // 10. Explicit Robot / Manipulator / Humanoid Mech
  if (/\b(robot|arm|manipulator|mech|android|bot)\b|روبوت|آلي|ذراع/.test(p)) {
    const primary = colorChoice?.primary ?? '#e2e8f0';
    const accent = colorChoice?.accent ?? '#38bdf8';
    const parts = scaleBlueprint([
      { id: 'base_plate', name: 'Machined Steel Anchor Base', role: 'primary', primitive: 'cylinder', dimensions: [0.82, 0.92, 0.26], position: [0, 0.13, 0], rotation: [0, 0, 0], color: '#1e293b', roughness: 0.4, metalness: 0.85 },
      { id: 'turret', name: 'Servo Turret Housing', role: 'primary', primitive: 'cylinder', dimensions: [0.46, 0.52, 0.54], position: [0, 0.53, 0], rotation: [0, 0, 0], color: '#334155', roughness: 0.35, metalness: 0.78, spinAxis: 'y' },
      { id: 'shoulder_joint', name: 'Shoulder Harmonic Drive', role: 'accent', primitive: 'cylinder', dimensions: [0.26, 0.26, 0.52], position: [0, 0.95, 0], rotation: [0, 0, Math.PI / 2], color: '#f59e0b', roughness: 0.28, metalness: 0.88 },
      { id: 'lower_arm', name: 'Primary Alloy Boom', role: 'secondary', primitive: 'box', dimensions: [0.28, 1.25, 0.28], position: [0, 1.52, 0.18], rotation: [0.25, 0, 0], color: primary, roughness: 0.32, metalness: 0.55 },
      { id: 'elbow_joint', name: 'Elbow Actuator Drum', role: 'accent', primitive: 'cylinder', dimensions: [0.2, 0.2, 0.42], position: [0, 2.08, 0.34], rotation: [0, 0, Math.PI / 2], color: accent, roughness: 0.22, metalness: 0.85 },
      { id: 'forearm', name: 'Forearm Wrist Link', role: 'secondary', primitive: 'box', dimensions: [0.2, 0.2, 1.05], position: [0, 2.15, 0.85], rotation: [-0.18, 0, 0], color: '#cbd5e1', roughness: 0.35, metalness: 0.6 },
      { id: 'gripper_hub', name: 'Precision End-Effector Flange', role: 'accent', primitive: 'cylinder', dimensions: [0.16, 0.14, 0.18], position: [0, 2.25, 1.4], rotation: [Math.PI / 2, 0, 0], color: '#0f172a', roughness: 0.25, metalness: 0.9 },
      { id: 'jaw_left', name: 'Parallel Gripper Jaw L', role: 'accent', primitive: 'box', dimensions: [0.05, 0.18, 0.26], position: [-0.1, 2.25, 1.58], rotation: [0, 0, 0], color: accent, roughness: 0.2, metalness: 0.82 },
      { id: 'jaw_right', name: 'Parallel Gripper Jaw R', role: 'accent', primitive: 'box', dimensions: [0.05, 0.18, 0.26], position: [0.1, 2.25, 1.58], rotation: [0, 0, 0], color: accent, roughness: 0.2, metalness: 0.82 },
    ], scale);
    return {
      title: '6-DOF Articulated Industrial Manipulator',
      category: 'Robotics & Automation',
      prompt,
      boundingBox: computeBoundingBox(parts),
      parts,
    };
  }

  // 11. General Parametric Synthesizer for Custom / Unclassified Prompts
  const palette = colorChoice ?? { primary: '#0284c7', secondary: '#334155', accent: '#38bdf8', label: 'Azure' };
  const isGlowing = /\b(glow|neon|lamp|lantern|crystal|energy|reactor|beacon)\b|مضيء|نيون|مصباح|كريستال|طاقة/.test(p);
  const isSpherical = /\b(sphere|orb|ball|globe|planet|dome)\b|كرة|كروي|قبة|كوكب/.test(p);
  const isRinged = /\b(ring|portal|orbit|halo|wheel|torus)\b|حلقة|بوابة|مدار/.test(p);
  const isGlass = /\b(glass|crystal|transparent|ice)\b|زجاج|كريستال|شفاف/.test(p);

  const customParts = scaleBlueprint([
    {
      id: 'base_plinth',
      name: 'Precision Pedestal Plinth',
      role: 'secondary',
      primitive: 'cylinder',
      dimensions: [1.1, 1.3, 0.28],
      position: [0, 0.14, 0],
      rotation: [0, 0, 0],
      color: palette.secondary,
      roughness: 0.45,
      metalness: 0.72,
    },
    {
      id: 'core_body',
      name: isSpherical ? 'Primary Spherical Core' : 'Primary Sculpted Volume',
      role: 'primary',
      primitive: isSpherical ? 'sphere' : 'cylinder',
      dimensions: isSpherical ? [0.78, 24, 18] : [0.65, 0.8, 1.5],
      position: [0, isSpherical ? 1.35 : 1.05, 0],
      rotation: [0, 0, 0],
      color: palette.primary,
      roughness: isGlass ? 0.1 : 0.28,
      metalness: isGlass ? 0.25 : 0.65,
      clearcoat: isGlass ? 1.0 : 0.4,
      ...(isGlowing ? { emissive: palette.accent } : {}),
    },
    {
      id: 'orbital_ring',
      name: isRinged ? 'Primary Toroidal Halo' : 'Gyroscopic Stabilizer Ring',
      role: 'accent',
      primitive: 'torus',
      dimensions: [1.08, 0.07, 18],
      position: [0, 1.35, 0],
      rotation: [Math.PI / 3, 0.3, 0],
      color: palette.accent,
      roughness: 0.22,
      metalness: 0.85,
      ...(isGlowing ? { emissive: palette.accent } : {}),
      spinAxis: 'y',
    },
    {
      id: 'fin_left',
      name: 'Symmetric Structural Fin L',
      role: 'secondary',
      primitive: 'box',
      dimensions: [0.14, 1.25, 0.52],
      position: [-0.88, 1.1, 0],
      rotation: [0, 0, -0.15],
      color: palette.secondary,
      roughness: 0.35,
      metalness: 0.65,
    },
    {
      id: 'fin_right',
      name: 'Symmetric Structural Fin R',
      role: 'secondary',
      primitive: 'box',
      dimensions: [0.14, 1.25, 0.52],
      position: [0.88, 1.1, 0],
      rotation: [0, 0, 0.15],
      color: palette.secondary,
      roughness: 0.35,
      metalness: 0.65,
    },
    {
      id: 'crown_cone',
      name: 'Upper Telemetry Crown',
      role: 'accent',
      primitive: 'cone',
      dimensions: [0.45, 0.72, 20],
      position: [0, 2.35, 0],
      rotation: [0, 0, 0],
      color: palette.accent,
      roughness: 0.22,
      metalness: 0.78,
      ...(isGlowing ? { emissive: palette.primary } : {}),
    },
  ], scale);

  return {
    title: makeTitleFromPrompt(prompt, `${palette.label} Parametric Assembly`),
    category: 'Custom Parametric Concept',
    prompt,
    boundingBox: computeBoundingBox(customParts),
    parts: customParts,
  };
}

export function generateWorldBlueprint(prompt: string): ProceduralWorldBlueprint {
  const p = prompt.toLowerCase();
  const isCoastal = /\b(ocean|sea|island|beach|harbor|port|coast|water|lake|river|bay)\b|بحر|جزيرة|شاطئ|ميناء|نهر|بحيرة|ماء/.test(p);
  const isMars = /\b(mars|space|moon|crater|planet|asteroid|lunar)\b|مريخ|فضاء|قمر|كوكب/.test(p);
  const isArctic = /\b(arctic|snow|ice|glacier|frozen|winter|tundra)\b|ثلج|جليد|قطبي|شتاء/.test(p);
  const isCyber = /\b(cyber|neon|futuristic|sci-fi|metropolis|cyberpunk|grid)\b|سايبر|نيون|مستقبل/.test(p);
  const isDesert = /\b(desert|dune|oasis|sand|canyon)\b|صحراء|واحة|رمال/.test(p);
  const isAlpine = /\b(mountain|alpine|forest|valley|pine|hills)\b|جبل|غابة|وادي/.test(p);

  const isNight = /\b(night|dark|midnight)\b|ليل|مظلم/.test(p) || isCyber;
  const isDusk = /\b(dusk|sunset|evening|twilight)\b|غروب|مساء/.test(p);
  const timeOfDay: ProceduralWorldBlueprint['timeOfDay'] = isNight ? 'night' : isDusk ? 'dusk' : 'day';

  const biome: WorldBiome = isCoastal
    ? 'coastal_port'
    : isMars
      ? 'mars_colony'
      : isArctic
        ? 'arctic_station'
        : isCyber
          ? 'cyber_metropolis'
          : isDesert
            ? 'desert_outpost'
            : isAlpine
              ? 'alpine_research'
              : 'urban_campus';

  const isDense = /\b(city|metropolis|dense|towers|downtown)\b|مدينة|كثيف|أبراج/.test(p);
  const count = isDense ? 20 : isMars || isArctic ? 12 : 16;

  const paletteByBiome: Record<WorldBiome, {
    title: string;
    sky: string;
    fog: string;
    terrain: string;
    water: string;
    foliage: string;
    accent: string;
    buildingEven: string;
    buildingOdd: string;
    waterLevel: number;
    gravity: number;
    amplitude: number;
  }> = {
    coastal_port: {
      title: 'Coastal Island Harbor & Marina',
      sky: isNight ? '#07111f' : isDusk ? '#291d3a' : '#0c2340',
      fog: isNight ? '#07111f' : '#0f2942',
      terrain: '#a38d68',
      water: '#0284c7',
      foliage: '#16a34a',
      accent: '#38bdf8',
      buildingEven: '#e2e8f0',
      buildingOdd: '#64748b',
      waterLevel: 0.35,
      gravity: 9.81,
      amplitude: 2.1,
    },
    mars_colony: {
      title: 'Ares Crater Mars Research Colony',
      sky: '#2c1510',
      fog: '#3d1d15',
      terrain: '#9a4326',
      water: '#38bdf8',
      foliage: '#ea580c',
      accent: '#fb923c',
      buildingEven: '#e2e8f0',
      buildingOdd: '#94a3b8',
      waterLevel: -4.0,
      gravity: 3.72,
      amplitude: 3.4,
    },
    arctic_station: {
      title: 'Polar Cryosphere Telemetry Station',
      sky: isNight ? '#06111f' : '#132a42',
      fog: '#1b3550',
      terrain: '#cbd5e1',
      water: '#0369a1',
      foliage: '#475569',
      accent: '#22d3ee',
      buildingEven: '#f8fafc',
      buildingOdd: '#64748b',
      waterLevel: 0.18,
      gravity: 9.81,
      amplitude: 2.8,
    },
    cyber_metropolis: {
      title: 'Neon Cyber Metropolis Grid',
      sky: '#050814',
      fog: '#090d20',
      terrain: '#0f172a',
      water: '#0ea5e9',
      foliage: '#06b6d4',
      accent: '#c084fc',
      buildingEven: '#1e1b4b',
      buildingOdd: '#1e293b',
      waterLevel: /water|river|canal|بحر|نهر/.test(p) ? 0.22 : -1.5,
      gravity: 9.81,
      amplitude: 0.9,
    },
    desert_outpost: {
      title: 'Arid Solar Research Outpost',
      sky: isNight ? '#0a0908' : '#2b241d',
      fog: '#2b241d',
      terrain: '#8a6b49',
      water: '#0284c7',
      foliage: '#65a30d',
      accent: '#f59e0b',
      buildingEven: '#b48a64',
      buildingOdd: '#9a7352',
      waterLevel: /oasis|lake|water|واحة|بحيرة|ماء/.test(p) ? 0.2 : -4.0,
      gravity: 9.81,
      amplitude: 1.8,
    },
    alpine_research: {
      title: 'Alpine Telemetry & Forest Station',
      sky: isNight ? '#070b14' : '#0f1c2e',
      fog: '#16283f',
      terrain: '#2b4738',
      water: '#0284c7',
      foliage: '#15803d',
      accent: '#34d399',
      buildingEven: '#475569',
      buildingOdd: '#334155',
      waterLevel: /river|lake|water|نهر|بحيرة|ماء/.test(p) ? 0.25 : -1.2,
      gravity: 9.81,
      amplitude: 3.5,
    },
    urban_campus: {
      title: 'OMNIX Digital Twin Campus',
      sky: isNight ? '#070b14' : isDusk ? '#241a35' : '#0f172a',
      fog: isNight ? '#070b14' : '#0f172a',
      terrain: '#1e293b',
      water: '#0284c7',
      foliage: '#15803d',
      accent: '#38bdf8',
      buildingEven: '#334155',
      buildingOdd: '#475569',
      waterLevel: /river|lake|water|نهر|بحيرة|ماء/.test(p) ? 0.25 : -1.2,
      gravity: 9.81,
      amplitude: 0.8,
    },
  };

  const cfg = paletteByBiome[biome];
  const buildings: WorldBuilding[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const ringRadius = isCoastal ? 10 + (i % 3) * 5.5 : 16 + (i % 3) * 9;
    const x = Number((Math.cos(angle) * ringRadius).toFixed(2));
    const z = Number((Math.sin(angle) * ringRadius).toFixed(2));
    const floors = isCyber ? 5 + ((i * 3) % 10) : isMars || isArctic ? 2 + (i % 4) : 2 + ((i * 3) % 7);
    const roofType: WorldBuilding['roofType'] =
      isMars || isArctic
        ? i % 2 === 0
          ? 'dome'
          : 'flat'
        : i % 5 === 0
          ? 'spire'
          : i % 4 === 0
            ? 'dome'
            : 'flat';

    buildings.push({
      id: `bld-${i + 1}`,
      name: isMars ? `Hab Dome ${i + 1}` : isCoastal ? `Harbor Pier ${i + 1}` : `Sector Tower ${i + 1}`,
      x,
      z,
      width: 3.1 + (i % 3) * 1.0,
      height: floors * 2.1,
      depth: 3.1 + ((i + 1) % 3) * 1.0,
      floors,
      color: i % 2 === 0 ? cfg.buildingEven : cfg.buildingOdd,
      roofType,
    });
  }

  const treePositions: ProceduralWorldBlueprint['treePositions'] = [];
  const treeCount = isMars ? 0 : isArctic ? 8 : isDesert ? 12 : 32;
  for (let i = 0; i < treeCount; i++) {
    const angle = i * 2.39996;
    const rad = isCoastal ? 6 + ((i * 5) % 15) : 10 + ((i * 7) % 32);
    const x = Number((Math.cos(angle) * rad).toFixed(2));
    const z = Number((Math.sin(angle) * rad).toFixed(2));
    if (Math.abs(x) < 3.5 || Math.abs(z) < 3.5) continue;
    treePositions.push({
      x,
      z,
      scale: 0.8 + (i % 4) * 0.18,
    });
  }

  const features: string[] = [];
  if (cfg.waterLevel > 0) features.push('reflective_water');
  if (isCoastal || /\bbridge\b|جسر/.test(p)) features.push('bridge');
  if (isMars || isDesert) features.push('solar_array');

  return {
    title: prompt.trim() && biome === 'urban_campus' && !/digital twin campus/i.test(prompt)
      ? makeTitleFromPrompt(prompt, cfg.title)
      : cfg.title,
    biome,
    prompt,
    skyColor: cfg.sky,
    fogColor: cfg.fog,
    terrainColor: cfg.terrain,
    waterColor: cfg.water,
    foliageColor: cfg.foliage,
    accentColor: cfg.accent,
    waterLevel: cfg.waterLevel,
    gravity: cfg.gravity,
    timeOfDay,
    terrainAmplitude: cfg.amplitude,
    features,
    buildings,
    roadControlPoints: [
      [-45, 0],
      [-15, 0],
      [0, 0],
      [15, 0],
      [45, 0],
    ],
    treePositions,
    actors: [
      {
        id: 'actor-1',
        name: isCoastal ? 'Harbor Patrol Boat 01' : isMars ? 'Ares Rover 01' : 'Rover Unit 01',
        x: -6,
        z: 2.2,
        speed: 2.2,
        heading: 0,
        color: cfg.accent,
      },
      {
        id: 'actor-2',
        name: isMars ? 'Core Drill Bot 02' : 'Survey Bot 02',
        x: 5,
        z: -2.2,
        speed: 1.7,
        heading: Math.PI,
        color: '#f59e0b',
      },
      {
        id: 'actor-3',
        name: 'Aerial Recon Drone 03',
        x: 0,
        z: 7.5,
        speed: 2.6,
        heading: Math.PI / 2,
        color: '#10b981',
      },
    ],
  };
}

export function serializeBlueprintToOBJ(blueprint: Procedural3DBlueprint): string {
  const lines: string[] = [
    `# OMNIX 3D Parametric Export — ${blueprint.title}`,
    `# Parts: ${blueprint.parts.length}`,
    '',
  ];
  let vertexOffset = 1;

  for (const part of blueprint.parts) {
    lines.push(`o ${part.id}_${part.name.replace(/\s+/g, '_')}`);
    const [w, h, d] =
      part.primitive === 'box'
        ? part.dimensions
        : [part.dimensions[0] * 2, part.dimensions[1], part.dimensions[0] * 2];
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const [px, py, pz] = part.position;

    const verts = [
      [px - hw, py - hh, pz - hd],
      [px + hw, py - hh, pz - hd],
      [px + hw, py + hh, pz - hd],
      [px - hw, py + hh, pz - hd],
      [px - hw, py - hh, pz + hd],
      [px + hw, py - hh, pz + hd],
      [px + hw, py + hh, pz + hd],
      [px - hw, py + hh, pz + hd],
    ];
    for (const [vx, vy, vz] of verts) {
      lines.push(`v ${vx.toFixed(4)} ${vy.toFixed(4)} ${vz.toFixed(4)}`);
    }
    const faces = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [1, 2, 6, 5],
      [0, 3, 7, 4],
    ];
    for (const [a, b, c, e] of faces) {
      lines.push(
        `f ${vertexOffset + a} ${vertexOffset + b} ${vertexOffset + c} ${vertexOffset + e}`
      );
    }
    vertexOffset += 8;
  }
  return lines.join('\n');
}

export function serializeBlueprintToSTL(blueprint: Procedural3DBlueprint): string {
  const lines: string[] = [`solid ${blueprint.title.replace(/\s+/g, '_')}`];
  for (const part of blueprint.parts) {
    const [w, h, d] =
      part.primitive === 'box'
        ? part.dimensions
        : [part.dimensions[0] * 2, part.dimensions[1], part.dimensions[0] * 2];
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const [px, py, pz] = part.position;

    const v = [
      [px - hw, py - hh, pz - hd],
      [px + hw, py - hh, pz - hd],
      [px + hw, py + hh, pz - hd],
      [px - hw, py + hh, pz - hd],
      [px - hw, py - hh, pz + hd],
      [px + hw, py - hh, pz + hd],
      [px + hw, py + hh, pz + hd],
      [px - hw, py + hh, pz + hd],
    ];
    const tris = [
      [0, 2, 1], [0, 3, 2],
      [4, 5, 6], [4, 6, 7],
      [0, 1, 5], [0, 5, 4],
      [2, 3, 7], [2, 7, 6],
      [1, 2, 6], [1, 6, 5],
      [0, 4, 7], [0, 7, 3],
    ];
    for (const [i1, i2, i3] of tris) {
      lines.push('  facet normal 0 0 1');
      lines.push('    outer loop');
      lines.push(`      vertex ${v[i1][0].toFixed(4)} ${v[i1][1].toFixed(4)} ${v[i1][2].toFixed(4)}`);
      lines.push(`      vertex ${v[i2][0].toFixed(4)} ${v[i2][1].toFixed(4)} ${v[i2][2].toFixed(4)}`);
      lines.push(`      vertex ${v[i3][0].toFixed(4)} ${v[i3][1].toFixed(4)} ${v[i3][2].toFixed(4)}`);
      lines.push('    endloop');
      lines.push('  endfacet');
    }
  }
  lines.push(`endsolid ${blueprint.title.replace(/\s+/g, '_')}`);
  return lines.join('\n');
}

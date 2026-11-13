import {
  extractColorFromPrompt,
  generateWorldBlueprint,
  type ProceduralWorldBlueprint,
} from './procedural3d';

export type WorldInterpretationStatus = 'accepted' | 'rejected';

export interface WorldParameterDiff {
  parameter: string;
  from: string;
  to: string;
}

export interface WorldInterpretationResult {
  status: WorldInterpretationStatus;
  mode: 'contextual_update' | 'full_generation' | 'rejected';
  headline: string;
  reason: string;
  appliedChanges: WorldParameterDiff[];
  updatedWorld?: ProceduralWorldBlueprint;
  shouldCallRemoteGenerator: boolean;
}

const MIN_GRAVITY = 0.2;
const MAX_GRAVITY = 30.0;
const MIN_SCALE = 0.3;
const MAX_SCALE = 3.5;
const MIN_WATER = -6.0;
const MAX_WATER = 12.0;
const MIN_TERRAIN = 0.0;
const MAX_TERRAIN = 10.0;

function round2(n: number): number {
  return Number(n.toFixed(2));
}

export function interpretWorldInstruction(
  rawInstruction: string,
  currentWorld: ProceduralWorldBlueprint
): WorldInterpretationResult {
  const instruction = rawInstruction.trim();
  if (!instruction || instruction.length < 2) {
    return {
      status: 'rejected',
      mode: 'rejected',
      headline: 'Instruction Rejected — Empty Directive',
      reason:
        'Provide a world description (e.g. "Mars crater colony") or physical parameter command (e.g. "set gravity 1.62", "scale 1.4x", "raise water").',
      appliedChanges: [],
      shouldCallRemoteGenerator: false,
    };
  }

  // Reject pure symbols / gibberish numbers-only input without units or world words
  const hasLetter = /[a-zA-Z\u0600-\u06FF]/.test(instruction);
  if (!hasLetter) {
    return {
      status: 'rejected',
      mode: 'rejected',
      headline: 'Instruction Rejected — Unrecognized Syntax',
      reason:
        'Input contains no recognizable language terms. Describe a world biome or specify physical parameters like gravity, scale, water level, or time of day.',
      appliedChanges: [],
      shouldCallRemoteGenerator: false,
    };
  }

  const p = instruction.toLowerCase();
  const changes: WorldParameterDiff[] = [];
  const next: ProceduralWorldBlueprint = {
    ...currentWorld,
    buildings: currentWorld.buildings.map((b) => ({ ...b })),
    actors: currentWorld.actors.map((a) => ({ ...a })),
    treePositions: currentWorld.treePositions.map((t) => ({ ...t })),
    features: [...(currentWorld.features || [])],
  };

  // 1. Check explicit gravity commands
  const explicitGravityMatch = instruction.match(
    /(?:gravity|g\s*=|جاذبية|الجاذبية)\s*(?:to|at|is|=|:)?\s*(-?\d+(?:\.\d+)?)/i
  );
  if (explicitGravityMatch) {
    const val = Number(explicitGravityMatch[1]);
    if (!Number.isFinite(val) || val < MIN_GRAVITY || val > MAX_GRAVITY) {
      return {
        status: 'rejected',
        mode: 'rejected',
        headline: 'Instruction Rejected — Gravity Out of Bounds',
        reason: `Requested gravity (${val} m/s²) violates simulation stability limits (${MIN_GRAVITY}–${MAX_GRAVITY} m/s²).`,
        appliedChanges: [],
        shouldCallRemoteGenerator: false,
      };
    }
    if (val !== currentWorld.gravity) {
      changes.push({ parameter: 'gravity', from: `${currentWorld.gravity} m/s²`, to: `${round2(val)} m/s²` });
      next.gravity = round2(val);
    }
  } else if (/\b(zero gravity|0g|weightless)\b|انعدام الجاذبية/.test(p)) {
    return {
      status: 'rejected',
      mode: 'rejected',
      headline: 'Instruction Rejected — Zero Gravity Unsupported',
      reason: `Surface vehicle & building ground-contact solver requires positive gravity (${MIN_GRAVITY}–${MAX_GRAVITY} m/s²). Try "moon gravity 1.62" or "microgravity 0.25".`,
      appliedChanges: [],
      shouldCallRemoteGenerator: false,
    };
  } else if (/\b(moon gravity|lunar gravity)\b|جاذبية القمر/.test(p)) {
    changes.push({ parameter: 'gravity', from: `${currentWorld.gravity} m/s²`, to: '1.62 m/s²' });
    next.gravity = 1.62;
  } else if (/\b(mars gravity)\b|جاذبية المريخ/.test(p)) {
    changes.push({ parameter: 'gravity', from: `${currentWorld.gravity} m/s²`, to: '3.72 m/s²' });
    next.gravity = 3.72;
  } else if (/\b(earth gravity|normal gravity)\b|جاذبية الأرض/.test(p)) {
    changes.push({ parameter: 'gravity', from: `${currentWorld.gravity} m/s²`, to: '9.81 m/s²' });
    next.gravity = 9.81;
  } else if (/\b(low gravity|microgravity)\b|جاذبية منخفضة/.test(p)) {
    changes.push({ parameter: 'gravity', from: `${currentWorld.gravity} m/s²`, to: '2.4 m/s²' });
    next.gravity = 2.4;
  } else if (/\b(high gravity|heavy gravity|jupiter)\b|جاذبية عالية|جاذبية المشتري/.test(p)) {
    const g = /jupiter|المشتري/.test(p) ? 24.79 : 18.5;
    changes.push({ parameter: 'gravity', from: `${currentWorld.gravity} m/s²`, to: `${g} m/s²` });
    next.gravity = g;
  }

  // 2. Check explicit scale commands
  const explicitScaleMatch = instruction.match(
    /(?:scale|size|resize|مقياس|تكبير|تصغير|حجم)\s*(?:by|to|=|:)?\s*(-?\d+(?:\.\d+)?)\s*x?/i
  );
  let scaleFactor: number | null = null;
  if (explicitScaleMatch) {
    scaleFactor = Number(explicitScaleMatch[1]);
  } else if (/\b(double size|2x scale|scale up)\b|تكبير|مضاعفة الحجم/.test(p)) {
    scaleFactor = 1.45;
  } else if (/\b(half size|scale down|shrink)\b|تصغير/.test(p)) {
    scaleFactor = 0.7;
  }

  if (scaleFactor !== null) {
    if (!Number.isFinite(scaleFactor) || scaleFactor < MIN_SCALE || scaleFactor > MAX_SCALE) {
      return {
        status: 'rejected',
        mode: 'rejected',
        headline: 'Instruction Rejected — Scale Factor Out of Range',
        reason: `Requested scale (${scaleFactor}x) exceeds safe spatial viewport bounds (${MIN_SCALE}x–${MAX_SCALE}x).`,
        appliedChanges: [],
        shouldCallRemoteGenerator: false,
      };
    }
    next.buildings = next.buildings.map((b) => ({
      ...b,
      width: round2(Math.min(18, b.width * scaleFactor!)),
      height: round2(Math.min(42, b.height * scaleFactor!)),
      depth: round2(Math.min(18, b.depth * scaleFactor!)),
    }));
    next.terrainAmplitude = round2(Math.min(MAX_TERRAIN, Math.max(0.2, next.terrainAmplitude * scaleFactor)));
    changes.push({
      parameter: 'worldScale',
      from: '1.0x',
      to: `${round2(scaleFactor)}x (structures & relief)`,
    });
  }

  // 3. Water level & hydrology commands
  const explicitWaterMatch = instruction.match(
    /(?:water\s*level|flood\s*level|منسوب الماء|مستوى الماء)\s*(?:to|at|=|:)?\s*(-?\d+(?:\.\d+)?)/i
  );
  if (explicitWaterMatch) {
    const wl = Number(explicitWaterMatch[1]);
    if (!Number.isFinite(wl) || wl < MIN_WATER || wl > MAX_WATER) {
      return {
        status: 'rejected',
        mode: 'rejected',
        headline: 'Instruction Rejected — Water Level Out of Bounds',
        reason: `Water elevation (${wl} m) must stay within ${MIN_WATER} m to ${MAX_WATER} m.`,
        appliedChanges: [],
        shouldCallRemoteGenerator: false,
      };
    }
    changes.push({ parameter: 'waterLevel', from: `${currentWorld.waterLevel} m`, to: `${round2(wl)} m` });
    next.waterLevel = round2(wl);
  } else if (/\b(raise water|flood|add water|add lake|add ocean)\b|رفع الماء|إضافة ماء|بحيرة/.test(p)) {
    const newLevel = round2(Math.max(0.45, currentWorld.waterLevel + 0.8));
    changes.push({ parameter: 'waterLevel', from: `${currentWorld.waterLevel} m`, to: `${newLevel} m` });
    next.waterLevel = newLevel;
  } else if (/\b(drain water|remove water|dry terrain|lower water)\b|تصريف الماء|تجفيف/.test(p)) {
    changes.push({ parameter: 'waterLevel', from: `${currentWorld.waterLevel} m`, to: '-3.5 m' });
    next.waterLevel = -3.5;
  }

  // 4. Terrain amplitude / elevation commands
  const explicitTerrainMatch = instruction.match(
    /(?:terrain\s*(?:amplitude|height)|elevation|ارتفاع التضاريس)\s*(?:to|at|=|:)?\s*(-?\d+(?:\.\d+)?)/i
  );
  if (explicitTerrainMatch) {
    const amp = Number(explicitTerrainMatch[1]);
    if (!Number.isFinite(amp) || amp < MIN_TERRAIN || amp > MAX_TERRAIN) {
      return {
        status: 'rejected',
        mode: 'rejected',
        headline: 'Instruction Rejected — Terrain Relief Out of Bounds',
        reason: `Terrain amplitude (${amp} m) must be between ${MIN_TERRAIN} m and ${MAX_TERRAIN} m.`,
        appliedChanges: [],
        shouldCallRemoteGenerator: false,
      };
    }
    changes.push({ parameter: 'terrainAmplitude', from: `${currentWorld.terrainAmplitude} m`, to: `${round2(amp)} m` });
    next.terrainAmplitude = round2(amp);
  } else if (/\b(flatten terrain|flat ground)\b|تسطيح/.test(p)) {
    changes.push({ parameter: 'terrainAmplitude', from: `${currentWorld.terrainAmplitude} m`, to: '0.2 m' });
    next.terrainAmplitude = 0.2;
  } else if (/\b(steep mountains|higher mountains|raise terrain)\b|تضاريس جبلية/.test(p)) {
    const amp = round2(Math.min(MAX_TERRAIN, currentWorld.terrainAmplitude + 1.8));
    changes.push({ parameter: 'terrainAmplitude', from: `${currentWorld.terrainAmplitude} m`, to: `${amp} m` });
    next.terrainAmplitude = amp;
  }

  // 5. Time-of-day / lighting contextual switches (only when NOT requesting a whole new world biome)
  const sanitizedForBiomeCheck = p
    .replace(/\b(moon gravity|lunar gravity|mars gravity|earth gravity|jupiter)\b/g, '')
    .replace(/جاذبية\s*(?:القمر|المريخ|الأرض|المشتري)/g, '');
  const isNewWorldRequest =
    /\b(build|create|generate|design|make a|coastal|island|mars|arctic|desert|alpine|cyber|city|harbor|colony|outpost|station|campus)\b|صمم|أنشئ|ابن|عالم|جزيرة|مريخ|صحراء|مدينة|محطة|مستعمرة/.test(
      sanitizedForBiomeCheck
    );

  if (!isNewWorldRequest || changes.length > 0) {
    if (/\b(night|midnight)\b|ليل/.test(p) && currentWorld.timeOfDay !== 'night') {
      changes.push({ parameter: 'timeOfDay', from: currentWorld.timeOfDay, to: 'night' });
      next.timeOfDay = 'night';
    } else if (/\b(dusk|sunset|twilight)\b|غروب|مساء/.test(p) && currentWorld.timeOfDay !== 'dusk') {
      changes.push({ parameter: 'timeOfDay', from: currentWorld.timeOfDay, to: 'dusk' });
      next.timeOfDay = 'dusk';
    } else if (/\b(day|daylight|noon|morning)\b|نهار|صباح/.test(p) && currentWorld.timeOfDay !== 'day') {
      changes.push({ parameter: 'timeOfDay', from: currentWorld.timeOfDay, to: 'day' });
      next.timeOfDay = 'day';
    }

    // Actor speed adjustments
    if (/\b(faster|speed up|accelerate)\b|تسريع/.test(p)) {
      next.actors = next.actors.map((a) => ({ ...a, speed: round2(Math.min(7.5, a.speed * 1.5)) }));
      changes.push({ parameter: 'actorSpeed', from: '1.0x', to: '1.5x' });
    } else if (/\b(slower|slow down)\b|إبطاء/.test(p)) {
      next.actors = next.actors.map((a) => ({ ...a, speed: round2(Math.max(0.5, a.speed * 0.6)) }));
      changes.push({ parameter: 'actorSpeed', from: '1.0x', to: '0.6x' });
    }

    // Color overrides when editing existing world
    const colorChoice = extractColorFromPrompt(instruction);
    if (colorChoice && /\b(sky|fog|terrain|water|ground|color)\b|سماء|أرض|لون|ماء/.test(p)) {
      if (/\b(water)\b|ماء/.test(p)) {
        changes.push({ parameter: 'waterColor', from: currentWorld.waterColor || '#0284c7', to: colorChoice.primary });
        next.waterColor = colorChoice.primary;
      } else if (/\b(terrain|ground)\b|أرض/.test(p)) {
        changes.push({ parameter: 'terrainColor', from: currentWorld.terrainColor, to: colorChoice.primary });
        next.terrainColor = colorChoice.primary;
      } else {
        changes.push({ parameter: 'skyColor', from: currentWorld.skyColor, to: colorChoice.primary });
        next.skyColor = colorChoice.primary;
        next.fogColor = colorChoice.primary;
      }
    }
  }

  if (changes.length > 0 && !isNewWorldRequest) {
    return {
      status: 'accepted',
      mode: 'contextual_update',
      headline: `Instruction Accepted — Updated ${changes.length} Physical Parameter(s)`,
      reason: `Mapped directive directly onto "${currentWorld.title}" physical simulation properties.`,
      appliedChanges: changes,
      updatedWorld: next,
      shouldCallRemoteGenerator: false,
    };
  }

  // Reject single short random tokens like "asdf" or "xyz" that have neither valid parameter edits nor world context
  const wordCount = instruction.split(/\s+/).filter(Boolean).length;
  if (wordCount === 1 && !isNewWorldRequest && changes.length === 0) {
    return {
      status: 'rejected',
      mode: 'rejected',
      headline: 'Instruction Rejected — Ambiguous World Directive',
      reason: `"${instruction}" does not specify a recognizable world environment or physical parameter (gravity, scale, water level, terrain relief, or time of day).`,
      appliedChanges: [],
      shouldCallRemoteGenerator: false,
    };
  }

  // Full world generation directive (either new biome prompt or combined biome + physical overrides)
  const localPreview = generateWorldBlueprint(instruction);
  const effectiveGravity = next.gravity !== currentWorld.gravity ? next.gravity : localPreview.gravity;
  const effectiveWater = next.waterLevel !== currentWorld.waterLevel ? next.waterLevel : localPreview.waterLevel;
  const effectiveAmp = next.terrainAmplitude !== currentWorld.terrainAmplitude ? next.terrainAmplitude : localPreview.terrainAmplitude;

  return {
    status: 'accepted',
    mode: 'full_generation',
    headline: 'Instruction Accepted — Synthesizing World Environment',
    reason: `Mapped description to ${localPreview.biome} physical profile (g=${effectiveGravity} m/s², water=${effectiveWater} m, relief=${effectiveAmp} m).`,
    appliedChanges: [
      { parameter: 'biome', from: currentWorld.biome, to: localPreview.biome },
      { parameter: 'gravity', from: `${currentWorld.gravity} m/s²`, to: `${effectiveGravity} m/s²` },
      { parameter: 'waterLevel', from: `${currentWorld.waterLevel} m`, to: `${effectiveWater} m` },
      ...changes.filter((c) => c.parameter !== 'gravity' && c.parameter !== 'waterLevel'),
    ],
    shouldCallRemoteGenerator: true,
  };
}

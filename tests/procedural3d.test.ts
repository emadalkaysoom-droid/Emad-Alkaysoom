import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractColorFromPrompt,
  generate3DBlueprint,
  generateWorldBlueprint,
  sanitize3DBlueprint,
  sanitizeWorldBlueprint,
  serializeBlueprintToOBJ,
  serializeBlueprintToSTL,
} from '../shared/procedural3d';

test('generates composite 3-12 part 3D assemblies for prompts', () => {
  const car = generate3DBlueprint('Create a red 3D sports car');
  assert.ok(car.parts.length >= 3 && car.parts.length <= 12);
  assert.equal(car.category, 'Automotive');
  assert.equal(car.parts[0].color, '#dc2626');

  const drone = generate3DBlueprint('Autonomous survey drone');
  assert.ok(drone.parts.length >= 3 && drone.parts.length <= 12);
  assert.equal(drone.category, 'Aerospace');
});

test('recognizes Arabic & English custom 3D descriptions and colors', () => {
  const palette = extractColorFromPrompt('صاروخ فضائي ذهبي');
  assert.ok(palette && palette.primary === '#d97706');

  const rocket = generate3DBlueprint('Gold orbital rocket ship');
  assert.equal(rocket.category, 'Spacecraft Engineering');
  assert.ok(rocket.parts.length >= 6);

  const villa = generate3DBlueprint('صمم منزل حديث أبيض بسقف أزرق');
  assert.equal(villa.category, 'Architecture');
  assert.ok(villa.parts.some((p) => p.color === '#1d4ed8'));

  const bridge = generate3DBlueprint('Red suspension bridge');
  assert.equal(bridge.category, 'Civil Engineering');

  const customOrb = generate3DBlueprint('glowing purple crystal orb');
  assert.equal(customOrb.category, 'Custom Parametric Concept');
  assert.ok(customOrb.parts.some((p) => p.primitive === 'sphere' && p.emissive));
});

test('serializes 3D blueprints into valid OBJ and STL text', () => {
  const bp = generate3DBlueprint('wind turbine');
  const obj = serializeBlueprintToOBJ(bp);
  const stl = serializeBlueprintToSTL(bp);
  assert.ok(obj.includes('v ') && obj.includes('f '));
  assert.ok(stl.startsWith('solid ') && stl.includes('endsolid '));
});

test('generates procedural world layouts across biomes in EN & AR', () => {
  const desert = generateWorldBlueprint('Desert solar outpost');
  assert.equal(desert.biome, 'desert_outpost');
  assert.ok(desert.buildings.length >= 10);
  assert.ok(desert.actors.length >= 3);

  const coastal = generateWorldBlueprint('Coastal island harbor at dusk with bridges');
  assert.equal(coastal.biome, 'coastal_port');
  assert.equal(coastal.timeOfDay, 'dusk');
  assert.ok(coastal.waterLevel > 0);
  assert.ok(coastal.features?.includes('reflective_water'));

  const mars = generateWorldBlueprint('مستعمرة على كوكب المريخ');
  assert.equal(mars.biome, 'mars_colony');
  assert.equal(mars.gravity, 3.72);
  assert.equal(mars.treePositions.length, 0);

  const arctic = generateWorldBlueprint('Arctic snow station');
  assert.equal(arctic.biome, 'arctic_station');
});

test('sanitizes AI-generated 3D & world JSON blueprints safely', () => {
  assert.equal(sanitize3DBlueprint({ parts: [] }, 'bad'), null);

  const clean3d = sanitize3DBlueprint(
    {
      title: 'AI Spaceship',
      category: 'Sci-Fi',
      parts: [
        { id: 'hull', name: 'Hull', primitive: 'cylinder', dimensions: [0.5, 0.5, 2], position: [0, -1, 0], color: '#38bdf8' },
        { id: 'nose', name: 'Nose', primitive: 'cone', dimensions: [0.5, 1, 20], position: [0, 0.5, 0], color: '#ef4444' },
        { id: 'ring', name: 'Ring', primitive: 'torus', dimensions: [0.8, 0.08, 16], position: [0, -0.5, 0], color: '#fbbf24', spinAxis: 'z' },
      ],
    },
    'AI Spaceship'
  );
  assert.ok(clean3d);
  assert.equal(clean3d.parts.length, 3);
  // Ensure grounded lift brought lowest part up >= 0
  assert.ok(clean3d.parts[0].position[1] >= 1.0);

  const cleanWorld = sanitizeWorldBlueprint(
    {
      title: 'AI Harbor',
      biome: 'coastal_port',
      waterLevel: 0.4,
      buildings: [
        { id: 'b1', x: 8, z: 8, width: 4, height: 10, depth: 4, floors: 4, color: '#e2e8f0', roofType: 'dome' },
        { id: 'b2', x: -8, z: 8, width: 4, height: 12, depth: 4, floors: 5, color: '#94a3b8', roofType: 'spire' },
        { id: 'b3', x: 8, z: -8, width: 4, height: 8, depth: 4, floors: 3, color: '#e2e8f0', roofType: 'flat' },
      ],
    },
    'AI Harbor'
  );
  assert.ok(cleanWorld);
  assert.equal(cleanWorld.biome, 'coastal_port');
  assert.ok(cleanWorld.actors.length >= 3);
});

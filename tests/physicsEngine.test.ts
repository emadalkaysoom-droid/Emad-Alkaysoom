import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultPhysicsSnapshot, stepPhysics } from '../shared/physicsEngine';

test('gravity pulls airborne rigid bodies downward and detects ground bounce', () => {
  let snap = createDefaultPhysicsSnapshot();
  const initialY = snap.bodies[0].position.y;
  const config = { gravity: 9.81, airDrag: 0.01, groundFriction: 0.4, arenaHalfExtent: 6.5 };

  for (let i = 0; i < 120; i++) {
    snap = stepPhysics(snap, 0.02, config);
  }

  assert.ok(snap.time > 2.0);
  assert.ok(snap.collisionCount >= 1);
  assert.ok(snap.bodies[0].position.y < initialY);
});

test('two converging spheres collide and exchange momentum', () => {
  let snap = createDefaultPhysicsSnapshot();
  snap.bodies = [
    {
      id: 'a',
      label: 'A',
      shape: 'sphere',
      radius: 1,
      mass: 2,
      restitution: 1.0,
      friction: 0,
      position: { x: -1.1, y: 2, z: 0 },
      velocity: { x: 4, y: 0, z: 0 },
      color: '#fff',
      grounded: false,
    },
    {
      id: 'b',
      label: 'B',
      shape: 'sphere',
      radius: 1,
      mass: 2,
      restitution: 1.0,
      friction: 0,
      position: { x: 1.1, y: 2, z: 0 },
      velocity: { x: -4, y: 0, z: 0 },
      color: '#fff',
      grounded: false,
    },
  ];
  const config = { gravity: 0, airDrag: 0, groundFriction: 0, arenaHalfExtent: 10 };
  for (let i = 0; i < 10; i++) {
    snap = stepPhysics(snap, 0.02, config);
  }
  assert.ok(snap.collisionCount >= 1);
  assert.ok(snap.bodies[0].velocity.x < 0);
  assert.ok(snap.bodies[1].velocity.x > 0);
});

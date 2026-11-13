export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RigidBody {
  id: string;
  label: string;
  shape: 'sphere' | 'box';
  radius: number;
  mass: number;
  restitution: number;
  friction: number;
  position: Vec3;
  velocity: Vec3;
  color: string;
  grounded: boolean;
}

export interface SimParticle {
  position: Vec3;
  velocity: Vec3;
  life: number;
  maxLife: number;
}

export interface PhysicsConfig {
  gravity: number; // m/s^2 downward magnitude (e.g. 9.81)
  airDrag: number; // 0..0.1
  groundFriction: number; // 0..1
  arenaHalfExtent: number;
}

export interface PhysicsSnapshot {
  time: number;
  stepCount: number;
  collisionCount: number;
  totalKineticEnergy: number;
  totalPotentialEnergy: number;
  bodies: RigidBody[];
  particles: SimParticle[];
}

export function createDefaultPhysicsSnapshot(): PhysicsSnapshot {
  return {
    time: 0,
    stepCount: 0,
    collisionCount: 0,
    totalKineticEnergy: 0,
    totalPotentialEnergy: 0,
    bodies: [
      {
        id: 'body-alpha',
        label: 'Titanium Sphere A',
        shape: 'sphere',
        radius: 0.75,
        mass: 2.5,
        restitution: 0.78,
        friction: 0.35,
        position: { x: -3.2, y: 5.5, z: 0 },
        velocity: { x: 2.4, y: 0, z: 0.6 },
        color: '#38bdf8',
        grounded: false,
      },
      {
        id: 'body-beta',
        label: 'Alloy Core B',
        shape: 'sphere',
        radius: 0.95,
        mass: 4.0,
        restitution: 0.65,
        friction: 0.4,
        position: { x: 2.6, y: 3.8, z: -0.4 },
        velocity: { x: -1.9, y: 1.2, z: -0.3 },
        color: '#f59e0b',
        grounded: false,
      },
      {
        id: 'body-gamma',
        label: 'Composite Block C',
        shape: 'box',
        radius: 0.7,
        mass: 1.8,
        restitution: 0.55,
        friction: 0.5,
        position: { x: 0.2, y: 7.0, z: 1.8 },
        velocity: { x: 0.4, y: -0.5, z: -1.8 },
        color: '#10b981',
        grounded: false,
      },
    ],
    particles: [],
  };
}

export function spawnImpactParticles(origin: Vec3, count = 12): SimParticle[] {
  const created: SimParticle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const speed = 1.5 + (i % 4) * 0.65;
    created.push({
      position: { x: origin.x, y: Math.max(0.05, origin.y), z: origin.z },
      velocity: {
        x: Math.cos(angle) * speed,
        y: 2.0 + (i % 3) * 0.9,
        z: Math.sin(angle) * speed,
      },
      life: 0.85,
      maxLife: 0.85,
    });
  }
  return created;
}

export function stepPhysics(
  snapshot: PhysicsSnapshot,
  dt: number,
  config: PhysicsConfig
): PhysicsSnapshot {
  const clampedDt = Math.min(Math.max(dt, 0.001), 0.05);
  const bodies: RigidBody[] = snapshot.bodies.map((b) => ({
    ...b,
    position: { ...b.position },
    velocity: { ...b.velocity },
  }));

  let collisionCount = snapshot.collisionCount;
  const newParticles: SimParticle[] = [];

  // 1. Integrate forces & ground/wall collisions
  for (const b of bodies) {
    b.velocity.y -= config.gravity * clampedDt;

    const dragFactor = Math.max(0, 1 - config.airDrag * clampedDt);
    b.velocity.x *= dragFactor;
    b.velocity.y *= dragFactor;
    b.velocity.z *= dragFactor;

    b.position.x += b.velocity.x * clampedDt;
    b.position.y += b.velocity.y * clampedDt;
    b.position.z += b.velocity.z * clampedDt;

    // Ground plane y = 0
    if (b.position.y - b.radius <= 0) {
      const impactVy = Math.abs(b.velocity.y);
      b.position.y = b.radius;
      if (b.velocity.y < 0) {
        if (impactVy > 1.2) {
          collisionCount++;
          newParticles.push(
            ...spawnImpactParticles({ x: b.position.x, y: 0.05, z: b.position.z }, 6)
          );
        }
        b.velocity.y = impactVy > 0.35 ? impactVy * b.restitution : 0;
      }
      b.grounded = b.velocity.y === 0;
      // Apply Coulomb ground friction
      const frictionDecay = Math.max(0, 1 - config.groundFriction * b.friction * clampedDt * 6);
      b.velocity.x *= frictionDecay;
      b.velocity.z *= frictionDecay;
    } else {
      b.grounded = false;
    }

    // Arena walls
    const limit = config.arenaHalfExtent - b.radius;
    if (b.position.x > limit) {
      b.position.x = limit;
      b.velocity.x = -Math.abs(b.velocity.x) * b.restitution;
      collisionCount++;
    } else if (b.position.x < -limit) {
      b.position.x = -limit;
      b.velocity.x = Math.abs(b.velocity.x) * b.restitution;
      collisionCount++;
    }
    if (b.position.z > limit) {
      b.position.z = limit;
      b.velocity.z = -Math.abs(b.velocity.z) * b.restitution;
      collisionCount++;
    } else if (b.position.z < -limit) {
      b.position.z = -limit;
      b.velocity.z = Math.abs(b.velocity.z) * b.restitution;
      collisionCount++;
    }
  }

  // 2. Pairwise elastic/inelastic sphere-bounding collision resolution
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const dz = b.position.z - a.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const minDist = a.radius + b.radius;

      if (distSq < minDist * minDist && distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;

        // Positional correction
        const penetration = minDist - dist;
        const invMassA = 1 / a.mass;
        const invMassB = 1 / b.mass;
        const totalInvMass = invMassA + invMassB;

        a.position.x -= nx * penetration * (invMassA / totalInvMass);
        a.position.y -= ny * penetration * (invMassA / totalInvMass);
        a.position.z -= nz * penetration * (invMassA / totalInvMass);
        b.position.x += nx * penetration * (invMassB / totalInvMass);
        b.position.y += ny * penetration * (invMassB / totalInvMass);
        b.position.z += nz * penetration * (invMassB / totalInvMass);

        // Relative velocity along normal
        const rvx = b.velocity.x - a.velocity.x;
        const rvy = b.velocity.y - a.velocity.y;
        const rvz = b.velocity.z - a.velocity.z;
        const velAlongNormal = rvx * nx + rvy * ny + rvz * nz;

        if (velAlongNormal < 0) {
          const e = Math.min(a.restitution, b.restitution);
          const jImpulse = (-(1 + e) * velAlongNormal) / totalInvMass;

          a.velocity.x -= jImpulse * invMassA * nx;
          a.velocity.y -= jImpulse * invMassA * ny;
          a.velocity.z -= jImpulse * invMassA * nz;

          b.velocity.x += jImpulse * invMassB * nx;
          b.velocity.y += jImpulse * invMassB * ny;
          b.velocity.z += jImpulse * invMassB * nz;

          collisionCount++;
          newParticles.push(
            ...spawnImpactParticles(
              {
                x: (a.position.x + b.position.x) * 0.5,
                y: (a.position.y + b.position.y) * 0.5,
                z: (a.position.z + b.position.z) * 0.5,
              },
              8
            )
          );
        }
      }
    }
  }

  // 3. Step particles
  const particles: SimParticle[] = [];
  for (const p of [...snapshot.particles, ...newParticles]) {
    const nextLife = p.life - clampedDt;
    if (nextLife > 0) {
      const nextVy = p.velocity.y - config.gravity * clampedDt;
      const nextY = Math.max(0.02, p.position.y + nextVy * clampedDt);
      particles.push({
        position: {
          x: p.position.x + p.velocity.x * clampedDt,
          y: nextY,
          z: p.position.z + p.velocity.z * clampedDt,
        },
        velocity: {
          x: p.velocity.x * 0.98,
          y: nextY <= 0.02 ? Math.abs(nextVy) * 0.35 : nextVy,
          z: p.velocity.z * 0.98,
        },
        life: nextLife,
        maxLife: p.maxLife,
      });
    }
  }

  // 4. Compute mechanical energy totals
  let totalKineticEnergy = 0;
  let totalPotentialEnergy = 0;
  for (const b of bodies) {
    const vSq = b.velocity.x ** 2 + b.velocity.y ** 2 + b.velocity.z ** 2;
    totalKineticEnergy += 0.5 * b.mass * vSq;
    totalPotentialEnergy += b.mass * config.gravity * Math.max(0, b.position.y - b.radius);
  }

  return {
    time: Number((snapshot.time + clampedDt).toFixed(3)),
    stepCount: snapshot.stepCount + 1,
    collisionCount,
    totalKineticEnergy: Number(totalKineticEnergy.toFixed(2)),
    totalPotentialEnergy: Number(totalPotentialEnergy.toFixed(2)),
    bodies,
    particles: particles.slice(-120),
  };
}

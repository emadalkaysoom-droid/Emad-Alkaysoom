import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AlertTriangle, ChevronDown, ChevronUp, Pause, Play, RotateCcw, StepForward, Zap } from 'lucide-react';
import {
  createDefaultPhysicsSnapshot,
  stepPhysics,
  type PhysicsConfig,
  type PhysicsSnapshot,
} from '../../../shared/physicsEngine';

function detectSoftwareGl(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function SimulationView() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(true);
  const [gravity, setGravity] = useState(9.81);
  const [friction, setFriction] = useState(0.45);
  const [dockOpen, setDockOpen] = useState(true);
  const [telemetry, setTelemetry] = useState({
    time: 0,
    collisions: 0,
    kineticEnergy: 0,
    potentialEnergy: 0,
  });

  const runningRef = useRef(running);
  runningRef.current = running;
  const configRef = useRef<PhysicsConfig>({
    gravity,
    airDrag: 0.015,
    groundFriction: friction,
    arenaHalfExtent: 6.5,
  });
  configRef.current = {
    gravity,
    airDrag: 0.015,
    groundFriction: friction,
    arenaHalfExtent: 6.5,
  };

  const simRef = useRef<PhysicsSnapshot>(createDefaultPhysicsSnapshot());
  const syncMeshesRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const width = container.clientWidth || 960;
    const height = container.clientHeight || 540;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090e18');
    scene.fog = new THREE.Fog('#090e18', 18, 42);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 100);
    camera.position.set(8.5, 6.2, 10.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.target.set(0, 1.5, 0);

    const key = new THREE.DirectionalLight('#fff5eb', 2.1);
    key.position.set(8, 12, 6);
    key.castShadow = !isSoftwareGl;
    scene.add(key);
    scene.add(new THREE.HemisphereLight('#bae6fd', '#0f172a', 0.8));

    // Arena Floor & Boundary Rim
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 13),
      new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.82, metalness: 0.15 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(13, 13, '#334155', '#1e293b');
    grid.position.y = 0.015;
    scene.add(grid);

    // Rigid Body Meshes
    const bodyMeshes = new Map<string, THREE.Mesh>();
    for (const b of simRef.current.bodies) {
      const geo =
        b.shape === 'sphere'
          ? new THREE.SphereGeometry(b.radius, 24, 18)
          : new THREE.BoxGeometry(b.radius * 1.6, b.radius * 1.6, b.radius * 1.6);
      const mat = new THREE.MeshStandardMaterial({
        color: b.color,
        roughness: 0.3,
        metalness: 0.65,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      scene.add(mesh);
      bodyMeshes.set(b.id, mesh);
    }

    // Particle Pool (InstancedMesh)
    const maxParticles = 120;
    const particleGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
    const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, maxParticles);
    particleMesh.frustumCulled = false;
    scene.add(particleMesh);

    const dummy = new THREE.Object3D();

    const syncMeshes = () => {
      const snap = simRef.current;
      for (const b of snap.bodies) {
        const mesh = bodyMeshes.get(b.id);
        if (mesh) {
          mesh.position.set(b.position.x, b.position.y, b.position.z);
        }
      }
      for (let i = 0; i < maxParticles; i++) {
        const p = snap.particles[i];
        if (p) {
          const s = Math.max(0.1, p.life / p.maxLife);
          dummy.position.set(p.position.x, p.position.y, p.position.z);
          dummy.scale.setScalar(s);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.scale.setScalar(0.001);
        }
        dummy.updateMatrix();
        particleMesh.setMatrixAt(i, dummy.matrix);
      }
      particleMesh.instanceMatrix.needsUpdate = true;
    };
    syncMeshesRef.current = syncMeshes;

    let frameId = 0;
    let lastTime = performance.now();
    let lastHudUpdate = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      const now = performance.now();
      const dt = Math.min(0.033, (now - lastTime) / 1000);
      lastTime = now;

      if (runningRef.current) {
        simRef.current = stepPhysics(simRef.current, dt, configRef.current);
      }
      syncMeshes();
      controls.update();
      renderer.render(scene, camera);

      if (now - lastHudUpdate > 140) {
        lastHudUpdate = now;
        const s = simRef.current;
        setTelemetry({
          time: s.time,
          collisions: s.collisionCount,
          kineticEnergy: s.totalKineticEnergy,
          potentialEnergy: s.totalPotentialEnergy,
        });
      }

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 960;
      const h = container.clientHeight || 540;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  const stepOnce = () => {
    setRunning(false);
    simRef.current = stepPhysics(simRef.current, 0.02, configRef.current);
    syncMeshesRef.current?.();
    const s = simRef.current;
    setTelemetry({
      time: s.time,
      collisions: s.collisionCount,
      kineticEnergy: s.totalKineticEnergy,
      potentialEnergy: s.totalPotentialEnergy,
    });
  };

  const resetSim = () => {
    simRef.current = createDefaultPhysicsSnapshot();
    syncMeshesRef.current?.();
    setTelemetry({ time: 0, collisions: 0, kineticEnergy: 0, potentialEnergy: 0 });
  };

  const applyImpulse = () => {
    simRef.current = {
      ...simRef.current,
      bodies: simRef.current.bodies.map((b, i) => ({
        ...b,
        velocity: {
          x: b.velocity.x + (i % 2 === 0 ? 3.5 : -3.5),
          y: b.velocity.y + 5.5,
          z: b.velocity.z + (i === 1 ? 3.2 : -2.2),
        },
      })),
    };
  };

  return (
    <div className="relative h-[calc(100vh-8rem)] w-full overflow-hidden rounded-xl border border-slate-800 bg-[#090e18]">
      <div ref={mountRef} data-testid="omni-sim-canvas" className="h-full w-full" />

      {/* Telemetry & Engineering Disclaimer Banner */}
      <div className="pointer-events-none absolute start-4 top-4 z-10 max-w-lg rounded-lg border border-slate-700/80 bg-[#0f141f]/90 px-4 py-2.5 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-sm font-semibold text-slate-100">
            OMNI SIM — Rigid-Body & Particle Physics
          </h1>
          <span className="font-mono text-xs tabular-nums text-sky-300">
            t = {telemetry.time.toFixed(2)}s
          </span>
        </div>
        <p className="font-mono text-xs tabular-nums text-slate-300">
          Collisions: {telemetry.collisions} · KE: {telemetry.kineticEnergy.toFixed(1)} J · PE:{' '}
          {telemetry.potentialEnergy.toFixed(1)} J
        </p>
        <p className="flex items-center gap-1.5 text-[11px] text-amber-300/90">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>
            Interactive visual rigid-body physics; not a certified finite-element or structural engineering solver.
          </span>
        </p>
      </div>

      {/* Collapsible Bottom Control Dock */}
      <div className="absolute bottom-4 left-1/2 z-10 w-[min(920px,94%)] -translate-x-1/2 flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockOpen(!dockOpen)}
          className="mb-1.5 flex items-center gap-1.5 rounded-t-lg border border-b-0 border-slate-700 bg-[#0f141f]/95 px-3 py-1 text-xs font-medium text-slate-300 hover:text-white"
        >
          {dockOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          <span>{dockOpen ? 'Hide Controls' : 'Show Controls'}</span>
        </button>

        {dockOpen && (
          <div className="w-full rounded-xl border border-slate-700/80 bg-[#0f141f]/95 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRunning(!running)}
                className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 font-semibold text-slate-950 hover:bg-sky-400"
              >
                {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                <span>{running ? 'Pause' : 'Play'}</span>
              </button>
              <button
                type="button"
                onClick={stepOnce}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-slate-200 hover:border-slate-500"
              >
                <StepForward className="h-3.5 w-3.5" />
                <span>Step</span>
              </button>
              <button
                type="button"
                onClick={applyImpulse}
                className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-amber-200 hover:bg-amber-500/25"
              >
                <Zap className="h-3.5 w-3.5" />
                <span>Impulse</span>
              </button>
              <button
                type="button"
                onClick={resetSim}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-slate-200 hover:border-slate-500"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-slate-300">
                <span>Gravity</span>
                <input
                  type="range"
                  min={0}
                  max={25}
                  step={0.5}
                  value={gravity}
                  onChange={(e) => setGravity(Number(e.target.value))}
                  className="w-24 accent-sky-500"
                />
                <span className="font-mono tabular-nums w-14">{gravity.toFixed(1)} m/s²</span>
              </label>

              <label className="flex items-center gap-2 text-slate-300">
                <span>Friction</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={friction}
                  onChange={(e) => setFriction(Number(e.target.value))}
                  className="w-20 accent-sky-500"
                />
                <span className="font-mono tabular-nums w-8">{friction.toFixed(2)}</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

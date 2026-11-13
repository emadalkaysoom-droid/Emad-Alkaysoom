export interface MatrixOperationResult {
  operation: string;
  determinant?: number;
  solution?: number[];
  product?: number[][];
  inverse?: number[][];
  eigenNote?: string;
}

export interface OdeSimulationResult {
  model: string;
  equation: string;
  units: string;
  assumptions: string;
  t0: number;
  tEnd: number;
  dt: number;
  series: Array<{ t: number; y: number; dy?: number; y2?: number }>;
  summary: Record<string, number>;
}

export interface PhysicsExperimentResult {
  experimentType: 'projectile' | 'collision_1d' | 'thermodynamics_carnot' | 'harmonic_pendulum';
  equations: string[];
  units: Record<string, string>;
  assumptions: string[];
  metrics: Record<string, number>;
  trajectory: Array<{ t: number; x: number; y: number; vx?: number; vy?: number; ke?: number; pe?: number }>;
}

export interface MaterialSpec {
  id: string;
  name: string;
  category: 'Metal' | 'Composite' | 'Ceramic';
  youngsModulusGPa: number;
  yieldStrengthMPa: number;
  ultimateStrengthMPa: number;
  poissonsRatio: number;
  densityKgM3: number;
  thermalConductivityWmK: number;
  thermalExpansion1e6K: number;
  fractureStrainPct: number;
  sourceNote: string;
}

export interface MaterialAnalysisResult {
  material: MaterialSpec;
  appliedStressMPa: number;
  strainPct: number;
  factorOfSafetyYield: number;
  factorOfSafetyUltimate: number;
  regime: 'elastic' | 'yielding' | 'fracture';
  stressStrainCurve: Array<{ strainPct: number; stressMPa: number }>;
  equations: string[];
}

export interface EngineeringStructureResult {
  analysisType: 'beam_bending' | 'thermal_conduction';
  equations: string[];
  assumptions: string[];
  units: Record<string, string>;
  results: Record<string, number>;
  profileSeries: Array<{ position: number; value: number; secondary?: number }>;
}

export const REFERENCE_MATERIALS: MaterialSpec[] = [
  {
    id: 'mat-steel-a36',
    name: 'Structural Steel (ASTM A36)',
    category: 'Metal',
    youngsModulusGPa: 200,
    yieldStrengthMPa: 250,
    ultimateStrengthMPa: 400,
    poissonsRatio: 0.26,
    densityKgM3: 7850,
    thermalConductivityWmK: 49.8,
    thermalExpansion1e6K: 11.7,
    fractureStrainPct: 20.0,
    sourceNote: 'ASTM A36 Standard Carbon Steel Mechanical Reference',
  },
  {
    id: 'mat-alu-6061',
    name: 'Aluminum Alloy 6061-T6',
    category: 'Metal',
    youngsModulusGPa: 68.9,
    yieldStrengthMPa: 276,
    ultimateStrengthMPa: 310,
    poissonsRatio: 0.33,
    densityKgM3: 2700,
    thermalConductivityWmK: 167,
    thermalExpansion1e6K: 23.6,
    fractureStrainPct: 12.0,
    sourceNote: 'ASM Aerospace Specification 6061-T6 Reference',
  },
  {
    id: 'mat-ti-6al4v',
    name: 'Titanium Ti-6Al-4V (Grade 5)',
    category: 'Metal',
    youngsModulusGPa: 113.8,
    yieldStrengthMPa: 880,
    ultimateStrengthMPa: 950,
    poissonsRatio: 0.342,
    densityKgM3: 4430,
    thermalConductivityWmK: 6.7,
    thermalExpansion1e6K: 8.6,
    fractureStrainPct: 14.0,
    sourceNote: 'ASM Ti-6Al-4V Annealed Bar Standard',
  },
  {
    id: 'mat-cfrp',
    name: 'Carbon Fiber Epoxy Composite (Quasi-Isotropic)',
    category: 'Composite',
    youngsModulusGPa: 70,
    yieldStrengthMPa: 600,
    ultimateStrengthMPa: 650,
    poissonsRatio: 0.3,
    densityKgM3: 1600,
    thermalConductivityWmK: 5.0,
    thermalExpansion1e6K: 2.1,
    fractureStrainPct: 1.1,
    sourceNote: 'Standard Quasi-Isotropic Laminate Approximation',
  },
  {
    id: 'mat-concrete-c30',
    name: 'Portland Concrete (C30/37 Compression)',
    category: 'Ceramic',
    youngsModulusGPa: 33,
    yieldStrengthMPa: 30,
    ultimateStrengthMPa: 37,
    poissonsRatio: 0.2,
    densityKgM3: 2400,
    thermalConductivityWmK: 1.4,
    thermalExpansion1e6K: 10.0,
    fractureStrainPct: 0.35,
    sourceNote: 'EN 1992-1-1 Structural Concrete C30/37 Reference',
  },
  {
    id: 'mat-copper-c110',
    name: 'Annealed Copper (C11000 ETP)',
    category: 'Metal',
    youngsModulusGPa: 117,
    yieldStrengthMPa: 70,
    ultimateStrengthMPa: 220,
    poissonsRatio: 0.34,
    densityKgM3: 8940,
    thermalConductivityWmK: 398,
    thermalExpansion1e6K: 16.5,
    fractureStrainPct: 45.0,
    sourceNote: 'Copper Development Association C11000 Standard',
  },
];

// Gaussian elimination with partial pivoting for linear system Ax = b
export function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  if (n === 0 || b.length !== n || A.some((row) => row.length !== n)) {
    throw new Error('Matrix A must be square n×n and vector b must have length n.');
  }
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-12) {
      throw new Error('Matrix is singular or nearly singular.');
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    const pivot = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => Number(row[n].toFixed(8)));
}

export function matrixDeterminant(A: number[][]): number {
  const n = A.length;
  if (n === 0 || A.some((r) => r.length !== n)) throw new Error('Determinant requires square matrix.');
  const M = A.map((r) => [...r]);
  let det = 1;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[pivot][i])) pivot = r;
    }
    if (Math.abs(M[pivot][i]) < 1e-12) return 0;
    if (pivot !== i) {
      [M[i], M[pivot]] = [M[pivot], M[i]];
      det *= -1;
    }
    det *= M[i][i];
    for (let r = i + 1; r < n; r++) {
      const f = M[r][i] / M[i][i];
      for (let c = i; c < n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return Number(det.toFixed(8));
}

export function multiplyMatrices(A: number[][], B: number[][]): number[][] {
  if (A.length === 0 || B.length === 0 || A[0].length !== B.length) {
    throw new Error('Matrix dimensions incompatible for multiplication.');
  }
  const rows = A.length;
  const cols = B[0].length;
  const inner = B.length;
  const out: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let s = 0;
      for (let k = 0; k < inner; k++) s += A[i][k] * B[k][j];
      out[i][j] = Number(s.toFixed(8));
    }
  }
  return out;
}

export function computeStatisticsAndRegression(xs: number[], ys?: number[]): {
  count: number;
  meanX: number;
  stdDevX: number;
  minX: number;
  maxX: number;
  slope?: number;
  intercept?: number;
  rSquared?: number;
} {
  if (xs.length === 0) throw new Error('Input array cannot be empty.');
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - meanX) ** 2, 0) / n;
  const stdDevX = Math.sqrt(variance);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  if (!ys || ys.length !== n || n < 2) {
    return {
      count: n,
      meanX: Number(meanX.toFixed(6)),
      stdDevX: Number(stdDevX.toFixed(6)),
      minX,
      maxX,
    };
  }

  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const slope = denX > 0 ? num / denX : 0;
  const intercept = meanY - slope * meanX;
  const rSquared = denX > 0 && denY > 0 ? (num * num) / (denX * denY) : 1;

  return {
    count: n,
    meanX: Number(meanX.toFixed(6)),
    stdDevX: Number(stdDevX.toFixed(6)),
    minX,
    maxX,
    slope: Number(slope.toFixed(6)),
    intercept: Number(intercept.toFixed(6)),
    rSquared: Number(rSquared.toFixed(6)),
  };
}

// 4th-Order Runge-Kutta ODE Solver for standard scientific models
export function solveOdeModel(params: {
  model: 'damped_oscillator' | 'exponential_decay' | 'logistic_growth' | 'rc_charging';
  y0: number;
  v0?: number;
  paramA: number; // k or omega or r or Vmax
  paramB?: number; // damping zeta or K capacity or RC tau
  tEnd?: number;
  steps?: number;
}): OdeSimulationResult {
  const tEnd = Math.max(0.5, Math.min(200, params.tEnd ?? 10));
  const steps = Math.max(10, Math.min(400, params.steps ?? 100));
  const dt = tEnd / steps;
  const series: OdeSimulationResult['series'] = [];

  if (params.model === 'damped_oscillator') {
    const omega = Math.max(0.1, params.paramA);
    const gamma = Math.max(0, params.paramB ?? 0.15);
    let x = params.y0;
    let v = params.v0 ?? 0;
    for (let i = 0; i <= steps; i++) {
      const t = Number((i * dt).toFixed(4));
      series.push({ t, y: Number(x.toFixed(6)), dy: Number(v.toFixed(6)) });
      const f = (cx: number, cv: number): [number, number] => [cv, -2 * gamma * omega * cv - omega * omega * cx];
      const [k1x, k1v] = f(x, v);
      const [k2x, k2v] = f(x + 0.5 * dt * k1x, v + 0.5 * dt * k1v);
      const [k3x, k3v] = f(x + 0.5 * dt * k2x, v + 0.5 * dt * k2v);
      const [k4x, k4v] = f(x + dt * k3x, v + dt * k3v);
      x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    }
    return {
      model: 'Damped Harmonic Oscillator (RK4)',
      equation: 'd²x/dt² + 2·γ·ω₀·(dx/dt) + ω₀²·x = 0',
      units: 'x [m], v [m/s], t [s]',
      assumptions: 'Linear viscous damping and Hookean restoring force.',
      t0: 0,
      tEnd,
      dt,
      series,
      summary: { finalPosition: series[series.length - 1].y, peakAmplitude: Math.max(...series.map((p) => Math.abs(p.y))) },
    };
  }

  let y = params.y0;
  for (let i = 0; i <= steps; i++) {
    const t = Number((i * dt).toFixed(4));
    const deriv = (val: number) => {
      if (params.model === 'exponential_decay') return -Math.abs(params.paramA) * val;
      if (params.model === 'logistic_growth') {
        const cap = Math.max(1e-6, params.paramB ?? 100);
        return params.paramA * val * (1 - val / cap);
      }
      // rc_charging
      const tau = Math.max(1e-4, params.paramB ?? 2);
      return (params.paramA - val) / tau;
    };
    series.push({ t, y: Number(y.toFixed(6)), dy: Number(deriv(y).toFixed(6)) });
    const k1 = deriv(y);
    const k2 = deriv(y + 0.5 * dt * k1);
    const k3 = deriv(y + 0.5 * dt * k2);
    const k4 = deriv(y + dt * k3);
    y += (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
  }

  const eqMap = {
    exponential_decay: 'dy/dt = -λ · y',
    logistic_growth: 'dy/dt = r · y · (1 - y / K)',
    rc_charging: 'dV/dt = (V_source - V) / (R·C)',
  };

  return {
    model: params.model,
    equation: eqMap[params.model],
    units: params.model === 'rc_charging' ? 'V [Volts], t [s]' : 'y [dimensionless], t [s]',
    assumptions: 'Deterministic continuous ODE integrated via 4th-order Runge-Kutta.',
    t0: 0,
    tEnd,
    dt,
    series,
    summary: { initialY: params.y0, finalY: series[series.length - 1].y },
  };
}

export function runPhysicsExperiment(params: {
  experimentType: PhysicsExperimentResult['experimentType'];
  v0?: number;
  angleDeg?: number;
  gravity?: number;
  dragCoeff?: number;
  mass?: number;
  mass2?: number;
  v2?: number;
  restitution?: number;
  tHotK?: number;
  tColdK?: number;
  heatInJ?: number;
  lengthM?: number;
}): PhysicsExperimentResult {
  if (params.experimentType === 'projectile') {
    const v0 = Math.max(1, params.v0 ?? 35);
    const theta = ((params.angleDeg ?? 45) * Math.PI) / 180;
    const g = Math.max(0.5, params.gravity ?? 9.81);
    const k = Math.max(0, params.dragCoeff ?? 0.01);
    const m = Math.max(0.1, params.mass ?? 1);
    let x = 0;
    let y = 0;
    let vx = v0 * Math.cos(theta);
    let vy = v0 * Math.sin(theta);
    const dt = 0.04;
    const trajectory: PhysicsExperimentResult['trajectory'] = [];
    let maxHeight = 0;

    for (let step = 0; step < 600; step++) {
      const t = Number((step * dt).toFixed(3));
      const speed = Math.hypot(vx, vy);
      const ke = 0.5 * m * speed * speed;
      const pe = m * g * Math.max(0, y);
      trajectory.push({
        t,
        x: Number(x.toFixed(3)),
        y: Number(Math.max(0, y).toFixed(3)),
        vx: Number(vx.toFixed(3)),
        vy: Number(vy.toFixed(3)),
        ke: Number(ke.toFixed(2)),
        pe: Number(pe.toFixed(2)),
      });
      if (y > maxHeight) maxHeight = y;
      const ax = -(k / m) * speed * vx;
      const ay = -g - (k / m) * speed * vy;
      vx += ax * dt;
      vy += ay * dt;
      x += vx * dt;
      y += vy * dt;
      if (step > 0 && y <= 0) {
        trajectory.push({ t: Number(((step + 1) * dt).toFixed(3)), x: Number(x.toFixed(3)), y: 0, vx: Number(vx.toFixed(3)), vy: Number(vy.toFixed(3)) });
        break;
      }
    }

    return {
      experimentType: 'projectile',
      equations: ['a_x = -(c_d/m)·|v|·v_x', 'a_y = -g - (c_d/m)·|v|·v_y', 'KE = ½mv², PE = mgh'],
      units: { distance: 'm', velocity: 'm/s', energy: 'J', gravity: 'm/s²' },
      assumptions: ['Flat ground at y = 0', 'Uniform gravitational acceleration', 'Quadratic aerodynamic drag'],
      metrics: {
        rangeMeters: Number(x.toFixed(2)),
        maxHeightMeters: Number(maxHeight.toFixed(2)),
        flightTimeSeconds: trajectory[trajectory.length - 1]?.t ?? 0,
        impactSpeedMs: Number(Math.hypot(vx, vy).toFixed(2)),
      },
      trajectory,
    };
  }

  if (params.experimentType === 'collision_1d') {
    const m1 = Math.max(0.1, params.mass ?? 4);
    const m2 = Math.max(0.1, params.mass2 ?? 2);
    const u1 = params.v0 ?? 6;
    const u2 = params.v2 ?? -2;
    const e = Math.max(0, Math.min(1, params.restitution ?? 1));
    const v1Final = (m1 * u1 + m2 * u2 + m2 * e * (u2 - u1)) / (m1 + m2);
    const v2Final = (m1 * u1 + m2 * u2 + m1 * e * (u1 - u2)) / (m1 + m2);
    const pBefore = m1 * u1 + m2 * u2;
    const pAfter = m1 * v1Final + m2 * v2Final;
    const keBefore = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
    const keAfter = 0.5 * m1 * v1Final * v1Final + 0.5 * m2 * v2Final * v2Final;

    const trajectory: PhysicsExperimentResult['trajectory'] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i * 0.1;
      const before = t <= 1.0;
      const dtPhase = before ? t - 1.0 : t - 1.0;
      const x1 = before ? u1 * dtPhase : v1Final * dtPhase;
      const x2 = before ? u2 * dtPhase : v2Final * dtPhase;
      trajectory.push({ t: Number(t.toFixed(2)), x: Number(x1.toFixed(3)), y: Number(x2.toFixed(3)), ke: Number((before ? keBefore : keAfter).toFixed(2)) });
    }

    return {
      experimentType: 'collision_1d',
      equations: ['m₁u₁ + m₂u₂ = m₁v₁ + m₂v₂', 'e = (v₂ - v₁)/(u₁ - u₂)'],
      units: { mass: 'kg', velocity: 'm/s', momentum: 'kg·m/s', energy: 'J' },
      assumptions: ['1D frictionless track', 'Impulse collision at t = 1.0 s'],
      metrics: {
        v1FinalMs: Number(v1Final.toFixed(4)),
        v2FinalMs: Number(v2Final.toFixed(4)),
        momentumBefore: Number(pBefore.toFixed(4)),
        momentumAfter: Number(pAfter.toFixed(4)),
        kineticEnergyLossJ: Number((keBefore - keAfter).toFixed(4)),
      },
      trajectory,
    };
  }

  if (params.experimentType === 'thermodynamics_carnot') {
    const tHot = Math.max(2, params.tHotK ?? 800);
    const tCold = Math.max(1, Math.min(tHot - 1, params.tColdK ?? 300));
    const qIn = Math.max(1, params.heatInJ ?? 5000);
    const eta = 1 - tCold / tHot;
    const workOut = eta * qIn;
    const qRejected = qIn - workOut;
    const deltaEntropy = qIn / tHot;

    const trajectory = Array.from({ length: 12 }, (_, idx) => {
      const tc = 200 + idx * 40;
      const eff = tc < tHot ? (1 - tc / tHot) * 100 : 0;
      return { t: tc, x: tc, y: Number(eff.toFixed(2)) };
    });

    return {
      experimentType: 'thermodynamics_carnot',
      equations: ['η_max = 1 - T_c / T_h', 'W = η_max · Q_h', 'Q_c = Q_h - W'],
      units: { temperature: 'K', energy: 'J', entropy: 'J/K', efficiency: '%' },
      assumptions: ['Reversible Carnot ideal cycle', 'Temperatures in Kelvin (T_h > T_c > 0)'],
      metrics: {
        carnotEfficiencyPct: Number((eta * 100).toFixed(2)),
        maxWorkOutputJ: Number(workOut.toFixed(2)),
        heatRejectedJ: Number(qRejected.toFixed(2)),
        entropyTransferredJK: Number(deltaEntropy.toFixed(4)),
      },
      trajectory,
    };
  }

  // Harmonic pendulum
  const L = Math.max(0.1, params.lengthM ?? 2.0);
  const g = Math.max(0.5, params.gravity ?? 9.81);
  const theta0 = ((params.angleDeg ?? 20) * Math.PI) / 180;
  const omega = Math.sqrt(g / L);
  const period = (2 * Math.PI) / omega;
  const trajectory: PhysicsExperimentResult['trajectory'] = [];
  for (let i = 0; i <= 60; i++) {
    const t = Number((i * (period / 30)).toFixed(3));
    const ang = theta0 * Math.cos(omega * t);
    trajectory.push({ t, x: Number((L * Math.sin(ang)).toFixed(4)), y: Number((-L * Math.cos(ang)).toFixed(4)) });
  }
  return {
    experimentType: 'harmonic_pendulum',
    equations: ['T = 2π·√(L / g)', 'θ(t) = θ₀·cos(√(g/L)·t)'],
    units: { length: 'm', period: 's', angle: 'rad' },
    assumptions: ['Small-angle harmonic approximation', 'Massless rigid rod, frictionless pivot'],
    metrics: {
      periodSeconds: Number(period.toFixed(4)),
      frequencyHz: Number((1 / period).toFixed(4)),
      angularFreqRadS: Number(omega.toFixed(4)),
    },
    trajectory,
  };
}

export function analyzeMaterialStress(params: {
  materialId?: string;
  customMaterial?: Partial<MaterialSpec>;
  appliedForceN: number;
  crossSectionAreaMm2: number;
}): MaterialAnalysisResult {
  const base =
    REFERENCE_MATERIALS.find((m) => m.id === params.materialId) || REFERENCE_MATERIALS[0];
  const material: MaterialSpec = params.customMaterial
    ? {
        ...base,
        ...params.customMaterial,
        id: 'mat-custom',
        name: params.customMaterial.name || `Custom (${base.name})`,
        sourceNote: 'User-entered experimental material properties',
      }
    : base;

  const areaMm2 = Math.max(0.01, params.crossSectionAreaMm2);
  // 1 N / 1 mm^2 = 1 MPa
  const appliedStressMPa = Math.abs(params.appliedForceN) / areaMm2;
  const modulusMPa = material.youngsModulusGPa * 1000;
  const elasticStrain = appliedStressMPa / modulusMPa;
  const strainPct = elasticStrain * 100;
  const fosYield = appliedStressMPa > 0 ? material.yieldStrengthMPa / appliedStressMPa : 999;
  const fosUlt = appliedStressMPa > 0 ? material.ultimateStrengthMPa / appliedStressMPa : 999;
  const regime: MaterialAnalysisResult['regime'] =
    appliedStressMPa >= material.ultimateStrengthMPa
      ? 'fracture'
      : appliedStressMPa >= material.yieldStrengthMPa
        ? 'yielding'
        : 'elastic';

  const yieldStrainPct = (material.yieldStrengthMPa / modulusMPa) * 100;
  const ultStrainPct = Math.max(yieldStrainPct * 1.8, material.fractureStrainPct * 0.72);
  const stressStrainCurve: Array<{ strainPct: number; stressMPa: number }> = [];
  for (let i = 0; i <= 20; i++) {
    const sPct = (material.fractureStrainPct * i) / 20;
    let stress = 0;
    if (sPct <= yieldStrainPct) {
      stress = (sPct / 100) * modulusMPa;
    } else if (sPct <= ultStrainPct) {
      const frac = (sPct - yieldStrainPct) / Math.max(1e-6, ultStrainPct - yieldStrainPct);
      stress = material.yieldStrengthMPa + (material.ultimateStrengthMPa - material.yieldStrengthMPa) * Math.sin((frac * Math.PI) / 2);
    } else {
      const frac = (sPct - ultStrainPct) / Math.max(1e-6, material.fractureStrainPct - ultStrainPct);
      stress = material.ultimateStrengthMPa * (1 - 0.14 * frac);
    }
    stressStrainCurve.push({ strainPct: Number(sPct.toFixed(4)), stressMPa: Number(stress.toFixed(2)) });
  }

  return {
    material,
    appliedStressMPa: Number(appliedStressMPa.toFixed(3)),
    strainPct: Number(strainPct.toFixed(5)),
    factorOfSafetyYield: Number(fosYield.toFixed(3)),
    factorOfSafetyUltimate: Number(fosUlt.toFixed(3)),
    regime,
    stressStrainCurve,
    equations: ['σ = F / A  [MPa = N / mm²]', 'ε = σ / E  (Hooke’s Law)', 'FoS_yield = σ_y / σ'],
  };
}

export function runEngineeringAnalysis(params: {
  analysisType: 'beam_bending' | 'thermal_conduction';
  lengthM: number;
  loadN?: number;
  widthMm?: number;
  heightMm?: number;
  youngsModulusGPa?: number;
  yieldStrengthMPa?: number;
  beamSupport?: 'simply_supported' | 'cantilever';
  areaM2?: number;
  tempHotC?: number;
  tempColdC?: number;
  thermalConductivityWmK?: number;
}): EngineeringStructureResult {
  if (params.analysisType === 'beam_bending') {
    const L = Math.max(0.1, params.lengthM);
    const P = Math.max(1, params.loadN ?? 5000);
    const b = Math.max(1, params.widthMm ?? 50) / 1000;
    const h = Math.max(1, params.heightMm ?? 100) / 1000;
    const E = Math.max(1, params.youngsModulusGPa ?? 200) * 1e9;
    const yieldMPa = Math.max(1, params.yieldStrengthMPa ?? 250);
    const support = params.beamSupport ?? 'simply_supported';

    const I = (b * Math.pow(h, 3)) / 12; // m^4
    const c = h / 2;
    const maxMomentNm = support === 'cantilever' ? P * L : (P * L) / 4;
    const maxDeflectionM = support === 'cantilever' ? (P * Math.pow(L, 3)) / (3 * E * I) : (P * Math.pow(L, 3)) / (48 * E * I);
    const maxBendingStressMPa = ((maxMomentNm * c) / I) / 1e6;
    const safetyFactor = yieldMPa / Math.max(1e-6, maxBendingStressMPa);

    const profileSeries: EngineeringStructureResult['profileSeries'] = [];
    for (let i = 0; i <= 20; i++) {
      const x = (L * i) / 20;
      let deflMm = 0;
      let momentNm = 0;
      if (support === 'cantilever') {
        deflMm = (((P * x * x) / (6 * E * I)) * (3 * L - x)) * 1000;
        momentNm = P * (L - x);
      } else {
        const xm = x <= L / 2 ? x : L - x;
        deflMm = (((P * xm) / (48 * E * I)) * (3 * L * L - 4 * xm * xm)) * 1000;
        momentNm = (P / 2) * xm;
      }
      profileSeries.push({ position: Number(x.toFixed(3)), value: Number(deflMm.toFixed(4)), secondary: Number(momentNm.toFixed(2)) });
    }

    return {
      analysisType: 'beam_bending',
      equations:
        support === 'cantilever'
          ? ['I = b·h³ / 12', 'M_max = P·L', 'δ_max = P·L³ / (3·E·I)', 'σ_max = M_max·c / I']
          : ['I = b·h³ / 12', 'M_max = P·L / 4', 'δ_max = P·L³ / (48·E·I)', 'σ_max = M_max·c / I'],
      assumptions: ['Euler-Bernoulli linear elastic beam theory', 'Rectangular uniform cross-section', 'Point load P applied cleanly'],
      units: { deflection: 'mm', stress: 'MPa', moment: 'N·m', inertia: 'cm⁴' },
      results: {
        momentOfInertiaCm4: Number((I * 1e8).toFixed(3)),
        maxMomentNm: Number(maxMomentNm.toFixed(2)),
        maxDeflectionMm: Number((maxDeflectionM * 1000).toFixed(4)),
        maxBendingStressMPa: Number(maxBendingStressMPa.toFixed(3)),
        safetyFactor: Number(safetyFactor.toFixed(3)),
      },
      profileSeries,
    };
  }

  // 1D steady-state Fourier thermal conduction
  const L = Math.max(0.005, params.lengthM);
  const A = Math.max(0.0001, params.areaM2 ?? 0.25);
  const tHot = params.tempHotC ?? 120;
  const tCold = params.tempColdC ?? 25;
  const k = Math.max(0.01, params.thermalConductivityWmK ?? 49.8);
  const dT = tHot - tCold;
  const heatFluxW = (k * A * dT) / L;
  const thermalResistanceKW = L / (k * A);
  const profileSeries = Array.from({ length: 11 }, (_, idx) => {
    const pos = (L * idx) / 10;
    const temp = tHot - (dT * pos) / L;
    return { position: Number(pos.toFixed(4)), value: Number(temp.toFixed(2)) };
  });

  return {
    analysisType: 'thermal_conduction',
    equations: ['q = -k·A·(dT/dx) = k·A·(T_hot - T_cold) / L', 'R_th = L / (k·A)'],
    assumptions: ['1D steady-state heat conduction', 'Constant isotropic thermal conductivity k', 'No internal heat generation'],
    units: { heatRate: 'W', flux: 'W/m²', resistance: 'K/W', temperature: '°C' },
    results: {
      heatTransferRateW: Number(heatFluxW.toFixed(2)),
      heatFluxWm2: Number((heatFluxW / A).toFixed(2)),
      thermalResistanceKW: Number(thermalResistanceKW.toFixed(5)),
    },
    profileSeries,
  };
}

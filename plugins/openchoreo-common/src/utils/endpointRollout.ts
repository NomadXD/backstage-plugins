import type {
  EndpointBackendWeight,
  EndpointHeaderMatch,
  EndpointRollout,
  EndpointWeightOverride,
  RolloutPlan,
  RolloutPosition,
  RolloutPreview,
  RolloutSettings,
} from '../types/endpoint-rollout-types';
import {
  buildABTest,
  buildBlueGreen,
  buildCanary,
  buildMirror,
  detectEndpointStrategy,
  isSameBackend,
  MOBILE_USER_AGENT,
  type StrategyChange,
} from './endpointStrategies';

/** The Endpoint annotation that records the rollout the portal started. */
export const ROLLOUT_ANNOTATION = 'openchoreo.dev/rollout';

/** One stage of a rollout: where the candidate's traffic share stands. */
export interface RolloutStage {
  /** Stable id, e.g. canary-25, preview, switched. */
  id: string;
  /** The candidate's share of traffic at this stage, 0 to 100. */
  percent: number;
  /** What the stage is called on screen. */
  label: string;
  /** The button that moves an environment to this stage. */
  action: string;
}

/**
 * The Endpoint's split when the rollout started, which abandoning restores.
 * A rollout recorded before the baseline was kept has `stable` alone.
 */
export function stableSplit(
  rollout: EndpointRollout,
): EndpointWeightOverride[] {
  const kept = (rollout.baseline ?? []).filter(b => (b.weight ?? 0) > 0);
  return kept.length > 0 ? kept : [{ name: rollout.stable, weight: 100 }];
}

/**
 * The backends outside the rollout: every version serving when it started
 * other than the one it replaces. Like the other services on an Argo
 * Rollouts or Flagger route, they keep their traffic throughout.
 */
export function untouchedSplit(
  rollout: EndpointRollout,
): EndpointWeightOverride[] {
  return stableSplit(rollout).filter(
    b => b.name !== rollout.stable && b.name !== rollout.candidate,
  );
}

/**
 * The split a completed rollout leaves: the new version with the replaced
 * version's weight, and every untouched backend as it was.
 */
export function completeSplit(
  rollout: EndpointRollout,
): EndpointWeightOverride[] {
  const untouched = untouchedSplit(rollout);
  if (untouched.length === 0) return [{ name: rollout.candidate, weight: 100 }];
  const replaced =
    stableSplit(rollout).find(b => b.name === rollout.stable)?.weight ?? 0;
  return [...untouched, { name: rollout.candidate, weight: replaced }];
}

/**
 * Splits `total` across `weights` in their ratio as whole numbers that add
 * up to `total` exactly (largest remainder).
 */
function shareOut(
  weights: EndpointWeightOverride[],
  total: number,
): EndpointWeightOverride[] {
  const sum = weights.reduce((acc, w) => acc + (w.weight ?? 0), 0);
  if (sum <= 0) return weights.map(w => ({ ...w, weight: 0 }));
  const exact = weights.map(w => ((w.weight ?? 0) / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((acc, w) => acc + w, 0);
  exact
    .map((x, i) => ({ i, rest: x - out[i] }))
    .sort((a, b) => b.rest - a.rest)
    .forEach(({ i }) => {
      if (left > 0) {
        out[i] += 1;
        left -= 1;
      }
    });
  return weights.map((w, i) => ({ name: w.name, weight: out[i] }));
}

/**
 * The header an A/B test's group must also carry: the recorded audience, or
 * the phone User-Agent for rollouts recorded with mobileOnly.
 */
export function abAudience(
  preview: RolloutPreview | undefined,
): EndpointHeaderMatch | undefined {
  if (preview?.audience) return preview.audience;
  return preview?.mobileOnly ? MOBILE_USER_AGENT : undefined;
}

/** The default canary steps. */
export const DEFAULT_CANARY_STEPS = [5, 25, 50, 100];

/** The copy shares a mirror rollout steps through. */
export const MIRROR_STEPS = [5, 10, 25, 50, 100];

/** The stages of a rollout, in order; the first is always 0%. */
export function rolloutStages(rollout: EndpointRollout): RolloutStage[] {
  switch (rollout.strategy) {
    case 'mirror':
      return [
        {
          id: 'mirror-0',
          percent: 0,
          label: 'Not copying',
          action: 'Stop copying',
        },
        ...rollout.steps.map(p => ({
          id: `mirror-${p}`,
          percent: p,
          label: `Copying ${p}%`,
          action: `Copy ${p}%`,
        })),
      ];
    case 'blueGreen':
      return [
        {
          id: 'preview',
          percent: 0,
          label: 'Preview only',
          action: 'Switch back to Current',
        },
        {
          id: 'switched',
          percent: 100,
          label: 'Switched to New version',
          action: 'Switch to New version',
        },
      ];
    case 'abTest':
      return [
        {
          id: 'experiment',
          percent: 0,
          label: 'Experiment running',
          action: 'Restart the experiment',
        },
        {
          id: 'shipped',
          percent: 100,
          label: 'New version for everyone',
          action: 'Ship to everyone',
        },
      ];
    default:
      return [
        {
          id: 'canary-0',
          percent: 0,
          label: 'Not started',
          action: 'Back to Current',
        },
        ...rollout.steps.map(p => ({
          id: p >= 100 ? 'canary-100' : `canary-${p}`,
          percent: p,
          label: p >= 100 ? 'All traffic on New version' : `Canary ${p}%`,
          action:
            p >= 100 ? 'Send all traffic to New version' : `Next step (${p}%)`,
        })),
      ];
  }
}

/**
 * Finds an environment's stage from what it serves: the effective weight of
 * each backend by name, and for a mirror rollout the candidate's effective
 * copy share. Values that match no stage are "set by hand".
 */
export function rolloutPosition(
  rollout: EndpointRollout,
  weights: Record<string, number>,
  mirrorPercent?: number,
): RolloutPosition {
  // The candidate's share of the traffic it and the replaced backend get;
  // untouched backends are outside the rollout.
  const candidate = weights[rollout.candidate] ?? 0;
  const total = candidate + (weights[rollout.stable] ?? 0);
  let percent = total > 0 ? Math.round((candidate / total) * 100) : 0;
  if (rollout.strategy === 'mirror') percent = mirrorPercent ?? 0;
  const index = rolloutStages(rollout).findIndex(s => s.percent === percent);
  return { index, percent, manual: index < 0 };
}

/** The stage after `index`, or undefined at the last stage. */
export function nextRolloutStage(
  rollout: EndpointRollout,
  position: RolloutPosition,
): RolloutStage | undefined {
  const stages = rolloutStages(rollout);
  if (position.manual) {
    return stages.find(s => s.percent > position.percent);
  }
  return stages[position.index + 1];
}

/** Weights total this much when untouched backends share the route. */
const SHARED_TOTAL = 10000;

/**
 * The binding weights that put an environment at `percent`: the candidate
 * gets that share of the replaced version's traffic, the replaced version
 * the rest, untouched backends their baseline share, and any other backend
 * 0. With nothing untouched the weights add up to 100; otherwise to 10000,
 * so a step of a small slice still reads back exactly.
 */
export function rolloutWeights(
  rollout: EndpointRollout,
  backendNames: string[],
  percent: number,
): EndpointWeightOverride[] {
  if (rollout.strategy === 'mirror') {
    return [{ name: rollout.candidate, mirror: { percent } }];
  }
  const untouched = untouchedSplit(rollout).filter(b =>
    backendNames.includes(b.name),
  );
  const replaced =
    stableSplit(rollout).find(b => b.name === rollout.stable)?.weight ?? 0;
  const untouchedTotal = untouched.reduce((sum, b) => sum + (b.weight ?? 0), 0);
  let slice = 100;
  let others = new Map<string, number>();
  if (untouched.length > 0 && replaced > 0) {
    slice = Math.round((SHARED_TOTAL * replaced) / (replaced + untouchedTotal));
    others = new Map(
      shareOut(untouched, SHARED_TOTAL - slice).map(b => [
        b.name,
        b.weight ?? 0,
      ]),
    );
  }
  const candidate = Math.round((slice * percent) / 100);
  return backendNames.map(name => {
    if (name === rollout.candidate) return { name, weight: candidate };
    if (name === rollout.stable) return { name, weight: slice - candidate };
    return { name, weight: others.get(name) ?? 0 };
  });
}

const isWeight = (b: any): b is EndpointWeightOverride =>
  typeof b?.name === 'string' &&
  typeof b?.weight === 'number' &&
  Number.isFinite(b.weight) &&
  b.weight >= 0;

/** The backends other than `candidate`, with their current weights. */
function baselineOf(
  backends: EndpointBackendWeight[],
  candidate: string,
): EndpointWeightOverride[] {
  return backends
    .map(b => ({ name: b.name ?? b.componentName, weight: b.weight }))
    .filter(b => b.name !== candidate);
}

const STRATEGIES = ['canary', 'blueGreen', 'abTest', 'mirror'];

/**
 * Reads the rollout annotation; undefined when absent or unreadable. Its
 * shape is that of the planned spec.rollout: `candidates`, and the steps
 * under the strategy (`canary.steps`, `mirror.steps`).
 */
export function parseRollout(
  annotations: Record<string, string> | undefined,
): EndpointRollout | undefined {
  const raw = annotations?.[ROLLOUT_ANNOTATION];
  if (!raw) return undefined;
  try {
    const r = JSON.parse(raw);
    const candidate = r?.candidates?.[0];
    const steps = r?.[r?.strategy]?.steps ?? [100];
    if (
      !STRATEGIES.includes(r?.strategy) ||
      typeof r.stable !== 'string' ||
      typeof candidate !== 'string' ||
      !Array.isArray(steps)
    ) {
      return undefined;
    }
    return {
      strategy: r.strategy,
      stable: r.stable,
      candidate,
      steps,
      ...(Array.isArray(r.baseline) &&
        r.baseline.every(isWeight) && { baseline: r.baseline }),
      ...(r.preview && { preview: r.preview }),
      ...(r.startedAt && { startedAt: r.startedAt }),
      ...(r.startedBy && { startedBy: r.startedBy }),
    };
  } catch {
    // An unreadable annotation is ignored: the strategy is detected instead.
  }
  return undefined;
}

/**
 * Writes the rollout annotation value in the shape of the planned
 * spec.rollout, so moving to the field later copies one block.
 */
export function serializeRollout(rollout: EndpointRollout): string {
  const { candidate, steps, strategy, ...rest } = rollout;
  return JSON.stringify({
    strategy,
    ...rest,
    candidates: [candidate],
    ...((strategy === 'canary' || strategy === 'mirror') && {
      [strategy]: { steps },
    }),
  });
}

/**
 * The rollout an Endpoint is running: the recorded one, or one detected from
 * its backends for Endpoints changed outside the portal.
 */
export function currentRollout(
  annotations: Record<string, string> | undefined,
  backends: EndpointBackendWeight[],
): { rollout?: EndpointRollout; source: 'annotation' | 'detected' | 'none' } {
  const recorded = parseRollout(annotations);
  const names = new Set(backends.map(b => b.name ?? b.componentName));
  if (recorded && names.has(recorded.stable) && names.has(recorded.candidate)) {
    const baseline = recorded.baseline?.filter(b => names.has(b.name));
    return {
      rollout: { ...recorded, ...(baseline && { baseline }) },
      source: 'annotation',
    };
  }
  const detected = detectEndpointStrategy(backends);
  switch (detected.kind) {
    case 'mirror':
      return {
        rollout: {
          strategy: 'mirror',
          stable: detected.stable,
          candidate: detected.shadow,
          baseline: baselineOf(backends, detected.shadow),
          steps: MIRROR_STEPS,
        },
        source: 'detected',
      };
    case 'canary':
      return {
        rollout: {
          strategy: 'canary',
          stable: detected.stable,
          candidate: detected.canary,
          baseline: baselineOf(backends, detected.canary),
          steps: DEFAULT_CANARY_STEPS,
        },
        source: 'detected',
      };
    case 'abTest':
      return {
        rollout: {
          strategy: 'abTest',
          stable: detected.control,
          candidate: detected.variant,
          baseline: baselineOf(backends, detected.variant),
          steps: [100],
        },
        source: 'detected',
      };
    default:
      return { source: 'none' };
  }
}

/**
 * The backends and note that start a rollout, written in one update: the
 * candidate joins at 0% with the match its preview needs, or its mirror.
 */
export function planRollout(
  backends: EndpointBackendWeight[],
  plan: RolloutPlan,
  startedBy?: string,
): StrategyChange & { rollout: EndpointRollout } {
  const preview = plan.preview;
  let change: StrategyChange;
  switch (plan.strategy) {
    case 'blueGreen':
      change = buildBlueGreen(
        backends,
        plan.candidate,
        preview?.kind === 'path' && preview.value
          ? { path: preview.value }
          : {
              header: {
                name: preview?.name || 'x-preview',
                value: preview?.value || 'green',
              },
            },
      );
      break;
    case 'mirror':
      change = buildMirror(backends, plan.candidate, plan.mirrorPercent ?? 100);
      break;
    case 'abTest':
      change = buildABTest(
        backends,
        plan.candidate,
        { name: preview?.name || 'exp_group', value: preview?.value || 'b' },
        abAudience(preview),
      );
      break;
    default:
      change = buildCanary(
        backends,
        plan.candidate,
        preview?.kind === 'header' && preview.name && preview.value
          ? { name: preview.name, value: preview.value }
          : undefined,
      );
  }
  const candidate =
    change.backends.find(b => isSameBackend(b, plan.candidate)) ??
    change.backends[change.backends.length - 1];
  let steps = [100];
  if (plan.strategy === 'canary') {
    steps = [
      ...new Set(
        (plan.steps?.length ? plan.steps : DEFAULT_CANARY_STEPS).filter(
          p => p > 0 && p <= 100,
        ),
      ),
    ].sort((a, b) => a - b);
  } else if (plan.strategy === 'mirror') {
    steps = [...new Set([...MIRROR_STEPS, plan.mirrorPercent ?? 100])]
      .filter(p => p > 0 && p <= 100)
      .sort((a, b) => a - b);
  }
  if (steps[steps.length - 1] !== 100) steps.push(100);
  const candidateName = candidate.name ?? candidate.componentName;
  // The rollout replaces one version, the picked one or else the one with
  // the most traffic; the others keep their weights (the baseline records
  // the whole split for abandoning).
  const baseline = baselineOf(backends, candidateName);
  const stable =
    baseline.find(b => b.name === plan.replaces && (b.weight ?? 0) > 0)?.name ??
    [...baseline].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0]?.name ??
    candidateName;
  return {
    ...change,
    rollout: {
      strategy: plan.strategy,
      stable,
      candidate: candidateName,
      baseline,
      steps,
      ...(preview && { preview }),
      startedAt: new Date().toISOString(),
      ...(startedBy && { startedBy }),
    },
  };
}

/** JSON with object keys sorted, to compare values written in any key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

/**
 * Changes a running rollout's settings: the new version's match or mirror
 * and the steps. The strategy, the versions and the baseline stay.
 * `releaseChanged` says whether the Endpoint's backends change, which cuts
 * a release; steps alone live only in the rollout annotation.
 */
export function reconfigureRollout(
  backends: EndpointBackendWeight[],
  rollout: EndpointRollout,
  settings: RolloutSettings,
): StrategyChange & { rollout: EndpointRollout; releaseChanged: boolean } {
  const candidate = backends.find(
    b => (b.name ?? b.componentName) === rollout.candidate,
  );
  if (!candidate) return { backends, rollout, releaseChanged: false };
  const planned = planRollout(backends, {
    strategy: rollout.strategy,
    candidate,
    replaces: rollout.stable,
    steps: settings.steps,
    preview: settings.preview,
    mirrorPercent: settings.mirrorPercent,
  });
  const after = planned.backends.find(b => isSameBackend(b, candidate))!;
  const { preview: _preview, ...kept } = rollout;
  return {
    backends: planned.backends,
    rollout: {
      ...kept,
      steps: planned.rollout.steps,
      ...(settings.preview && { preview: settings.preview }),
    },
    releaseChanged:
      canonical([candidate.match, candidate.mirror]) !==
      canonical([after.match, after.mirror]),
  };
}

/**
 * Turns a mirror rollout into a canary on the same backend: the mirror goes,
 * the testers header (if any) becomes its match, and the note restarts at
 * the canary's first stage.
 */
export function convertToCanary(
  backends: EndpointBackendWeight[],
  rollout: EndpointRollout,
  testerHeader?: { name: string; value: string },
): StrategyChange & { rollout: EndpointRollout } {
  const candidate = backends.find(
    b => (b.name ?? b.componentName) === rollout.candidate,
  );
  const change = candidate
    ? buildCanary(backends, candidate, testerHeader)
    : { backends };
  return {
    ...change,
    rollout: {
      ...rollout,
      strategy: 'canary',
      steps: DEFAULT_CANARY_STEPS,
      preview: testerHeader && { kind: 'header', ...testerHeader },
    },
  };
}

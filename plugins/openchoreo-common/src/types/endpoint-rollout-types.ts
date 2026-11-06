/**
 * BFF wire types for progressive delivery on Endpoints. Shared by
 * openchoreo-backend and the openchoreo frontend plugin.
 */

/** One backend of an Endpoint and its relative weight. */
export interface EndpointBackendWeight {
  /** The backend Component. */
  componentName: string;
  /** Workload endpoint name on the component. */
  endpoint: string;
  /** Release line of the component; absent for its main line. */
  releaseLine?: string;
  weight: number;
  /** The backend's name in the Endpoint (Endpoint.spec.backendRefs[].name). */
  name?: string;
  /**
   * Requests that meet all of these conditions go to this backend, whatever
   * the weights (Endpoint.spec.backendRefs[].match).
   */
  match?: EndpointBackendMatch;
  /** This backend gets a copy of a share of the weighted traffic. */
  mirror?: EndpointMirror;
}

/** A header condition of a backend's match. */
export interface EndpointHeaderMatch {
  name: string;
  type?: 'Exact' | 'RegularExpression';
  value: string;
}

/** An exact cookie condition of a backend's match. */
export interface EndpointNameValueMatch {
  name: string;
  value: string;
}

/**
 * The conditions a request must all meet to go to a backend, whatever the
 * weights. The path is relative to where the Endpoint is served.
 */
export interface EndpointBackendMatch {
  path?: { type?: 'PathPrefix' | 'Exact'; value: string };
  headers?: EndpointHeaderMatch[];
  /** At most one cookie. */
  cookies?: EndpointNameValueMatch[];
}

/** A copy of a share of the weighted traffic, for a backend at weight 0. */
export interface EndpointMirror {
  percent: number;
}

/** The strategies a rollout can run. */
export type RolloutStrategy = 'canary' | 'blueGreen' | 'abTest' | 'mirror';

/** How a person reaches the new backend before it gets traffic. */
export interface RolloutPreview {
  kind: 'header' | 'cookie' | 'path';
  name: string;
  value: string;
  /**
   * A/B only: a header the request must also carry, e.g. X-Client: ios or
   * a User-Agent pattern. Takes precedence over mobileOnly.
   */
  audience?: EndpointHeaderMatch;
  /** A/B only, from before audience: the cookie group must be on a phone. */
  mobileOnly?: boolean;
}

/**
 * The rollout running on an Endpoint: moving traffic from `stable` to
 * `candidate` (backend names) through `steps`, the candidate's share at each
 * stage after the first. Recorded on the Endpoint as an annotation so the
 * portal can show the stage and the next step after a reload.
 */
export interface EndpointRollout {
  strategy: RolloutStrategy;
  stable: string;
  candidate: string;
  /**
   * The Endpoint's other backends and their weights when the rollout
   * started. The candidate takes its share from `stable` only; the rest
   * keep their weights, and abandoning restores the whole split. Absent on
   * rollouts started before it was recorded: `stable` alone then.
   */
  baseline?: EndpointWeightOverride[];
  /** The candidate's percent at each stage after the first (which is 0). */
  steps: number[];
  preview?: RolloutPreview;
  startedAt?: string;
  startedBy?: string;
}

/** Where an environment stands in a rollout. */
export interface RolloutPosition {
  /** Index into rolloutStages; -1 when the weights match no stage. */
  index: number;
  /** The candidate's share of traffic there, 0 to 100, rounded. */
  percent: number;
  /** True when the weights were set by hand and match no stage. */
  manual: boolean;
}

/** What to start: the strategy, the new backend and its preview. */
export interface RolloutPlan {
  strategy: RolloutStrategy;
  candidate: { componentName: string; endpoint: string; releaseLine?: string };
  /** Canary only; defaults to 5, 25, 50, 100. */
  steps?: number[];
  preview?: RolloutPreview;
  /** Mirror only: the share of traffic to copy; defaults to 100. */
  mirrorPercent?: number;
  /**
   * The backend the new version replaces; defaults to the one with the most
   * traffic. Other backends keep their weights.
   */
  replaces?: string;
}

/**
 * A per-environment value on an EndpointReleaseBinding: a backend's weight,
 * or a mirror backend's copy share.
 */
export interface EndpointWeightOverride {
  /** The backend's name in the Endpoint. */
  name: string;
  weight?: number;
  mirror?: EndpointMirror;
}

/** A backend as it serves in one environment. */
export interface EndpointServedBackend {
  name: string;
  weight: number;
  mirror?: EndpointMirror;
  resolved: boolean;
  reason?: string;
}

/** What one environment's binding sets and serves. */
export interface EndpointRolloutEnvironment {
  environment: string;
  bindingName: string;
  endpointRelease?: string;
  overrides: EndpointWeightOverride[];
  backends: EndpointServedBackend[];
  rollout?: RolloutPosition;
}

/** Response of GET /endpoint-rollout: the Endpoint's backends, its rollout and each bound environment. */
export interface EndpointRolloutInfo {
  backends: EndpointBackendWeight[];
  rollout?: EndpointRollout;
  /** Whether the rollout was recorded by the portal or detected from the backends. */
  rolloutSource: 'annotation' | 'detected' | 'none';
  environments: EndpointRolloutEnvironment[];
}

/**
 * Request body of PUT /update-endpoint-overrides: per-environment weights on
 * the environment's binding. No release is cut.
 */
export interface UpdateEndpointOverridesRequest {
  namespaceName: string;
  endpointName: string;
  environment: string;
  /** An empty list clears the overrides, so the release's values apply. */
  overrides: EndpointWeightOverride[];
}

/** Request body of PUT /endpoint-rollout/start. */
export interface StartRolloutRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  plan: RolloutPlan;
}

/** Request body of PUT /endpoint-rollout/stage. */
export interface SetRolloutStageRequest {
  namespaceName: string;
  endpointName: string;
  environment: string;
  /** The candidate's share of traffic to set, 0 to 100. */
  percent: number;
}

/** Request body of PUT /endpoint-rollout/deploy. */
export interface DeployEndpointReleaseRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  environment: string;
  /** The release to pin; overrides for backends it doesn't have are dropped. */
  releaseName: string;
}

/** Request body of PUT /endpoint-rollout/convert: a mirror becomes a canary. */
export interface ConvertRolloutRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  /** A header testers send to reach the canary early, if any. */
  testerHeader?: { name: string; value: string };
}

/** What can change on a running rollout: how the new version is reached and its steps. */
export interface RolloutSettings {
  /** Canary: the new version's share at each step. */
  steps?: number[];
  /** How testers or the A/B group reach the new version; none removes it. */
  preview?: RolloutPreview;
  /** Mirror: the share of requests copied to the new version. */
  mirrorPercent?: number;
}

/** Request body of PUT /endpoint-rollout/settings. */
export interface UpdateRolloutSettingsRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  settings: RolloutSettings;
}

/** Request body of PUT /endpoint-rollout/finish. */
export interface FinishRolloutRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  /** complete keeps the candidate; abandon keeps the stable version. */
  outcome: 'complete' | 'abandon';
}

/** What a rollout action did in each environment it touched. */
export interface RolloutActionResult {
  latestRelease?: string;
  environments: Array<{ name: string; ok: boolean; error?: string }>;
}

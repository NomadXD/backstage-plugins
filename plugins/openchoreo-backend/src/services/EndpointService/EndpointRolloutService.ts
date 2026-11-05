import { LoggerService } from '@backstage/backend-plugin-api';
import { InputError, NotFoundError } from '@backstage/errors';
import {
  createOpenChoreoApiClient,
  assertApiResponse,
  fetchAllPages,
  type OpenChoreoComponents,
} from '@openchoreo/openchoreo-client-node';
import {
  CHOREO_LABELS,
  audienceProblem,
  endpointManagingComponent,
  completeSplit,
  convertToCanary,
  currentRollout,
  finishStrategy,
  planRollout,
  reconfigureRollout,
  ROLLOUT_ANNOTATION,
  rolloutPosition,
  rolloutWeights,
  serializeRollout,
  stableSplit,
  type ConvertRolloutRequest,
  type DeployEndpointReleaseRequest,
  type EndpointRollout,
  type EndpointRolloutInfo,
  type EndpointWeightOverride,
  type FinishRolloutRequest,
  type RolloutActionResult,
  type SetRolloutStageRequest,
  type StartRolloutRequest,
  type UpdateRolloutSettingsRequest,
  type UpdateEndpointOverridesRequest,
} from '@openchoreo/backstage-plugin-common';
import {
  applyBackends,
  servedWeights,
  toBackendWeights,
  toOverrides,
  validateMatches,
} from './endpointRolloutRefs';

type Endpoint = OpenChoreoComponents['schemas']['Endpoint'];
type EndpointReleaseBinding =
  OpenChoreoComponents['schemas']['EndpointReleaseBinding'];
type ApiClient = ReturnType<typeof createOpenChoreoApiClient>;

const RELEASE_WAIT_MS = 10_000;
const POLL_MS = 500;
const OVERRIDES_WAIT_MS = 20_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The Endpoint's labels once it routes to `backendRefs`. A component's
 * Endpoint that now routes to another component belongs to its project, so
 * the labels naming its source component go, as when a backend is added on
 * the Set up pane. A release line of the same component keeps them.
 */
function projectLabels(
  endpoint: Endpoint,
  backendRefs: NonNullable<Endpoint['spec']>['backendRefs'],
): Record<string, string> | undefined {
  const labels = endpoint.metadata.labels;
  const owner = endpointManagingComponent({
    labels,
    backendRefs: endpoint.spec?.backendRefs,
  });
  if (!owner || endpointManagingComponent({ labels, backendRefs })) {
    return labels;
  }
  const {
    [CHOREO_LABELS.ENDPOINT_SOURCE_COMPONENT]: _component,
    [CHOREO_LABELS.ENDPOINT_SOURCE_ENDPOINT]: _endpoint,
    [CHOREO_LABELS.ENDPOINT_SOURCE_RELEASE_LINE]: _line,
    ...rest
  } = labels ?? {};
  return rest;
}

function positionOf(rollout: EndpointRollout, binding: EndpointReleaseBinding) {
  const { weights, mirrors } = servedWeights(binding);
  return rolloutPosition(rollout, weights, mirrors[rollout.candidate]);
}

/**
 * Progressive delivery on Endpoints: per-environment weights on the
 * EndpointReleaseBinding, and rollouts that add a candidate backend at 0%
 * and move traffic to it environment by environment. All calls use the
 * caller's token; openchoreo-api enforces authorization.
 */
export class EndpointRolloutService {
  private readonly logger: LoggerService;
  private readonly baseUrl: string;

  constructor(logger: LoggerService, baseUrl: string) {
    this.logger = logger;
    this.baseUrl = baseUrl;
  }

  private client(token?: string): ApiClient {
    return createOpenChoreoApiClient({
      baseUrl: this.baseUrl,
      token,
      logger: this.logger,
    });
  }

  private async getEndpoint(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
  ): Promise<Endpoint> {
    const res = await client.GET(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      { params: { path: { namespaceName, endpointName } } },
    );
    assertApiResponse(res, 'get endpoint');
    return res.data!;
  }

  private async putEndpoint(
    client: ApiClient,
    namespaceName: string,
    endpoint: Endpoint,
    spec: NonNullable<Endpoint['spec']>,
  ): Promise<void> {
    const res = await client.PUT(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      {
        params: {
          path: { namespaceName, endpointName: endpoint.metadata.name },
        },
        body: { metadata: endpoint.metadata, spec },
      },
    );
    assertApiResponse(res, 'update endpoint');
  }

  private async listBindings(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
    projectName?: string,
  ): Promise<EndpointReleaseBinding[]> {
    const bindings = await fetchAllPages(cursor =>
      client
        .GET('/api/v1/namespaces/{namespaceName}/endpointreleasebindings', {
          params: {
            path: { namespaceName },
            query: { endpoint: endpointName, limit: 100, cursor },
          },
        })
        .then(res => {
          assertApiResponse(res, 'list endpoint release bindings');
          return res.data!;
        }),
    );
    return bindings.filter(
      b => !projectName || b.spec?.owner.projectName === projectName,
    );
  }

  private async findBinding(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
    environment: string,
    projectName?: string,
  ): Promise<EndpointReleaseBinding | undefined> {
    return (
      await this.listBindings(client, namespaceName, endpointName, projectName)
    ).find(b => b.spec?.environment === environment);
  }

  private async waitForRelease(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
    previous: string | undefined,
  ): Promise<string | undefined> {
    const deadline = Date.now() + RELEASE_WAIT_MS;
    while (Date.now() < deadline) {
      const current = await this.getEndpoint(
        client,
        namespaceName,
        endpointName,
      );
      const latest = current.status?.latestRelease?.name;
      if (latest && latest !== previous) {
        return latest;
      }
      await sleep(POLL_MS);
    }
    this.logger.warn(
      `Endpoint ${endpointName}: no new release within ${RELEASE_WAIT_MS}ms`,
    );
    return undefined;
  }

  /** The Endpoint's backends with their matches and mirrors, and its rollout. */
  async fetchEndpointRollout(
    namespaceName: string,
    endpointName: string,
    token?: string,
  ): Promise<EndpointRolloutInfo> {
    const client = this.client(token);
    const endpoint = await this.getEndpoint(
      client,
      namespaceName,
      endpointName,
    );
    const backends = toBackendWeights(endpoint.spec?.backendRefs);
    const { rollout, source } = currentRollout(
      endpoint.metadata.annotations,
      backends,
    );
    const bindings = await this.listBindings(
      client,
      namespaceName,
      endpointName,
      endpoint.spec?.owner.projectName,
    );
    return {
      backends,
      rollout,
      rolloutSource: source,
      environments: bindings.map(b => ({
        environment: b.spec!.environment,
        bindingName: b.metadata.name,
        endpointRelease: b.spec?.endpointRelease,
        overrides: toOverrides(b),
        backends: (b.status?.backends ?? []).map(x => ({
          name: x.name,
          weight: x.weight ?? 0,
          ...(x.mirror && { mirror: { percent: x.mirror.percent } }),
          resolved: x.resolved,
          ...(x.reason && { reason: x.reason }),
        })),
        ...(rollout && { rollout: positionOf(rollout, b) }),
      })),
    };
  }

  /**
   * Sets one environment's weights and mirror shares on its binding, without
   * cutting a release, and waits briefly for the data plane to take them.
   */
  async updateEndpointOverrides(
    request: UpdateEndpointOverridesRequest,
    token?: string,
  ): Promise<{ bindingName: string; applied: boolean }> {
    const client = this.client(token);
    const binding = await this.findBinding(
      client,
      request.namespaceName,
      request.endpointName,
      request.environment,
    );
    if (!binding) {
      throw new NotFoundError(
        `Endpoint ${request.endpointName} is not deployed in ${request.environment}; deploy a release there first`,
      );
    }
    const badWeight = request.overrides.filter(
      o =>
        o.weight !== undefined &&
        (!Number.isInteger(o.weight) || o.weight < 0 || o.weight > 1_000_000),
    );
    if (badWeight.length > 0) {
      throw new InputError(
        `Weights must be whole numbers from 0 to 1000000: ${badWeight
          .map(o => o.name)
          .join(', ')}`,
      );
    }
    const badMirror = request.overrides.filter(
      o =>
        o.mirror &&
        (!Number.isInteger(o.mirror.percent) ||
          o.mirror.percent < 0 ||
          o.mirror.percent > 100),
    );
    if (badMirror.length > 0) {
      throw new InputError(
        `Mirror shares must be whole numbers from 0 to 100: ${badMirror
          .map(o => o.name)
          .join(', ')}`,
      );
    }
    if (request.overrides.some(o => o.weight === undefined && !o.mirror)) {
      throw new InputError('Each override needs a weight or a mirror');
    }
    const res = await client.PUT(
      '/api/v1/namespaces/{namespaceName}/endpointreleasebindings/{endpointReleaseBindingName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointReleaseBindingName: binding.metadata.name,
          },
        },
        body: {
          metadata: binding.metadata,
          spec: { ...binding.spec!, backendOverrides: request.overrides },
        },
      },
    );
    assertApiResponse(res, 'update endpoint release binding');

    const wanted = new Map(
      request.overrides
        .filter(o => o.weight !== undefined)
        .map(o => [o.name, o.weight!]),
    );
    const wantedMirror = new Map(
      request.overrides
        .filter(o => o.mirror)
        .map(o => [o.name, o.mirror!.percent]),
    );
    const deadline = Date.now() + OVERRIDES_WAIT_MS;
    while (Date.now() < deadline) {
      const current = await this.findBinding(
        client,
        request.namespaceName,
        request.endpointName,
        request.environment,
      );
      const weightsMatch = (current?.status?.backends ?? []).every(
        b =>
          (!wanted.has(b.name) || (b.weight ?? 0) === wanted.get(b.name)) &&
          (!wantedMirror.has(b.name) ||
            (b.mirror?.percent ?? 0) === wantedMirror.get(b.name)),
      );
      const resourcesReady = current?.status?.conditions?.some(
        c => c.type === 'ResourcesReady' && c.status === 'True',
      );
      if (weightsMatch && resourcesReady) {
        return { bindingName: binding.metadata.name, applied: true };
      }
      await sleep(POLL_MS);
    }
    return { bindingName: binding.metadata.name, applied: false };
  }

  /**
   * Pins a release in an environment and sets its weights in the same
   * update, creating the binding when the environment has none.
   */
  private async pinRelease(
    client: ApiClient,
    request: {
      namespaceName: string;
      projectName: string;
      endpointName: string;
      environment: string;
      releaseName: string;
      backendOverrides: EndpointWeightOverride[];
    },
  ): Promise<void> {
    const existing = await this.findBinding(
      client,
      request.namespaceName,
      request.endpointName,
      request.environment,
      request.projectName,
    );
    if (existing) {
      const res = await client.PUT(
        '/api/v1/namespaces/{namespaceName}/endpointreleasebindings/{endpointReleaseBindingName}',
        {
          params: {
            path: {
              namespaceName: request.namespaceName,
              endpointReleaseBindingName: existing.metadata.name,
            },
          },
          body: {
            metadata: existing.metadata,
            spec: {
              ...existing.spec!,
              endpointRelease: request.releaseName,
              backendOverrides: request.backendOverrides,
            },
          },
        },
      );
      assertApiResponse(res, 'update endpoint release binding');
      return;
    }
    const res = await client.POST(
      '/api/v1/namespaces/{namespaceName}/endpointreleasebindings',
      {
        params: { path: { namespaceName: request.namespaceName } },
        body: {
          metadata: { name: `${request.endpointName}-${request.environment}` },
          spec: {
            owner: {
              projectName: request.projectName,
              endpointName: request.endpointName,
            },
            environment: request.environment,
            endpointRelease: request.releaseName,
            backendOverrides: request.backendOverrides,
          },
        },
      },
    );
    assertApiResponse(res, 'create endpoint release binding');
  }

  private async eachEnvironment(
    environments: string[],
    action: (environment: string) => Promise<unknown>,
  ): Promise<RolloutActionResult['environments']> {
    const results: RolloutActionResult['environments'] = [];
    for (const name of environments) {
      try {
        await action(name);
        results.push({ name, ok: true });
      } catch (err: unknown) {
        results.push({
          name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  private async requireRollout(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
  ) {
    const endpoint = await this.getEndpoint(
      client,
      namespaceName,
      endpointName,
    );
    const backends = toBackendWeights(endpoint.spec?.backendRefs);
    const { rollout } = currentRollout(endpoint.metadata.annotations, backends);
    if (!rollout) {
      throw new InputError(`No rollout is running on ${endpointName}`);
    }
    return { endpoint, rollout, backendNames: backends.map(b => b.name!) };
  }

  /**
   * Starts a rollout: the candidate joins at weight 0 with the match or
   * mirror its strategy needs, recorded in the rollout annotation, in one
   * Endpoint update. The release it cuts is deployed and promoted like any
   * other, and each environment starts with the candidate at 0%.
   */
  async startRollout(
    request: StartRolloutRequest,
    token?: string,
    startedBy?: string,
  ): Promise<RolloutActionResult> {
    const problem = audienceProblem(request.plan.preview?.audience);
    if (problem) throw new InputError(problem);
    const client = this.client(token);
    const endpoint = await this.getEndpoint(
      client,
      request.namespaceName,
      request.endpointName,
    );
    const backends = toBackendWeights(endpoint.spec?.backendRefs);
    const existing = currentRollout(endpoint.metadata.annotations, backends);
    if (existing.source === 'annotation') {
      throw new InputError(
        `A ${existing.rollout!.strategy} rollout to ${
          existing.rollout!.candidate
        } is already running; complete or abandon it first`,
      );
    }
    const planned = planRollout(backends, request.plan, startedBy);
    validateMatches(planned.backends);
    const backendRefs = applyBackends(
      endpoint.spec?.backendRefs ?? [],
      planned.backends,
      { reach: true },
    );
    const previous = endpoint.status?.latestRelease?.name;
    await this.putEndpoint(
      client,
      request.namespaceName,
      {
        ...endpoint,
        metadata: {
          ...endpoint.metadata,
          labels: projectLabels(endpoint, backendRefs),
          annotations: {
            ...(endpoint.metadata.annotations ?? {}),
            [ROLLOUT_ANNOTATION]: serializeRollout(planned.rollout),
          },
        },
      },
      { ...endpoint.spec!, backendRefs },
    );
    const latestRelease = await this.waitForRelease(
      client,
      request.namespaceName,
      request.endpointName,
      previous,
    );
    return { ...(latestRelease && { latestRelease }), environments: [] };
  }

  /** Moves one environment to a stage: the candidate gets `percent` of its traffic. */
  async setRolloutStage(
    request: SetRolloutStageRequest,
    token?: string,
  ): Promise<{ bindingName: string; applied: boolean }> {
    if (
      !Number.isInteger(request.percent) ||
      request.percent < 0 ||
      request.percent > 100
    ) {
      throw new InputError('percent must be a whole number from 0 to 100');
    }
    const { rollout, backendNames } = await this.requireRollout(
      this.client(token),
      request.namespaceName,
      request.endpointName,
    );
    return this.updateEndpointOverrides(
      {
        namespaceName: request.namespaceName,
        endpointName: request.endpointName,
        environment: request.environment,
        overrides: rolloutWeights(rollout, backendNames, request.percent),
      },
      token,
    );
  }

  /**
   * Changes the rollout's settings. Steps alone update the rollout
   * annotation. A new match or mirror for the new version is an Endpoint
   * change: it cuts a release, deployed and promoted like any other.
   */
  async updateRolloutSettings(
    request: UpdateRolloutSettingsRequest,
    token?: string,
  ): Promise<RolloutActionResult> {
    const problem = audienceProblem(request.settings.preview?.audience);
    if (problem) throw new InputError(problem);
    const client = this.client(token);
    const { endpoint, rollout } = await this.requireRollout(
      client,
      request.namespaceName,
      request.endpointName,
    );
    const next = reconfigureRollout(
      toBackendWeights(endpoint.spec?.backendRefs),
      rollout,
      request.settings,
    );
    validateMatches(next.backends);
    const metadata = {
      ...endpoint.metadata,
      annotations: {
        ...(endpoint.metadata.annotations ?? {}),
        [ROLLOUT_ANNOTATION]: serializeRollout(next.rollout),
      },
    };
    const spec = next.releaseChanged
      ? {
          ...endpoint.spec!,
          backendRefs: applyBackends(
            endpoint.spec?.backendRefs ?? [],
            next.backends,
            { reach: true },
          ),
        }
      : endpoint.spec!;
    const previous = endpoint.status?.latestRelease?.name;
    await this.putEndpoint(
      client,
      request.namespaceName,
      { ...endpoint, metadata },
      spec,
    );
    if (!next.releaseChanged) return { environments: [] };
    const latestRelease = await this.waitForRelease(
      client,
      request.namespaceName,
      request.endpointName,
      previous,
    );
    return { ...(latestRelease && { latestRelease }), environments: [] };
  }

  /**
   * Finishes the rollout. Complete keeps the candidate, once every
   * environment sends it all traffic; abandon puts back the split from
   * before the rollout. Either way it is one Endpoint change: the new
   * release is deployed and promoted like any other.
   */
  async finishRollout(
    request: FinishRolloutRequest,
    token?: string,
  ): Promise<RolloutActionResult> {
    const client = this.client(token);
    const { endpoint, rollout } = await this.requireRollout(
      client,
      request.namespaceName,
      request.endpointName,
    );
    if (request.outcome === 'complete' && rollout.strategy === 'mirror') {
      throw new InputError(
        `${rollout.candidate} only receives copies; turn it into a canary first`,
      );
    }
    const leaving =
      request.outcome === 'complete' ? rollout.stable : rollout.candidate;
    const serving = (
      await this.listBindings(
        client,
        request.namespaceName,
        request.endpointName,
        request.projectName,
      )
    )
      .filter(b => (servedWeights(b).weights[leaving] ?? 0) > 0)
      .map(b => b.spec!.environment);
    if (serving.length > 0) {
      throw new InputError(
        `${leaving} still gets traffic in ${serving.join(
          ', ',
        )}; move it to 0% there first`,
      );
    }
    const keep =
      request.outcome === 'complete'
        ? completeSplit(rollout)
        : stableSplit(rollout);
    const change = finishStrategy(
      toBackendWeights(endpoint.spec?.backendRefs),
      keep,
    );
    const kept = new Set(keep.map(k => k.name));
    const backendRefs = applyBackends(
      (endpoint.spec?.backendRefs ?? []).map(r =>
        kept.has(r.name) ? r : { ...r, weight: 0 },
      ),
      change.backends,
      { reach: true },
    );
    const annotations = { ...(endpoint.metadata.annotations ?? {}) };
    delete annotations[ROLLOUT_ANNOTATION];
    const previous = endpoint.status?.latestRelease?.name;
    await this.putEndpoint(
      client,
      request.namespaceName,
      { ...endpoint, metadata: { ...endpoint.metadata, annotations } },
      { ...endpoint.spec!, backendRefs },
    );
    const latestRelease = await this.waitForRelease(
      client,
      request.namespaceName,
      request.endpointName,
      previous,
    );
    return { ...(latestRelease && { latestRelease }), environments: [] };
  }

  /**
   * Deploys a release to an environment with the binding's overrides kept
   * only while they still fit it. Overrides are weights for one set of
   * backends; once the release removes one of them (a finished rollout),
   * they all go and the release's own weights apply, as they do when the
   * overrides would leave every backend at weight 0. Otherwise the version
   * that stays could keep a weight of 0, e.g. blue after a blue/green
   * switch, and get no traffic.
   */
  async deployRelease(
    request: DeployEndpointReleaseRequest,
    token?: string,
  ): Promise<RolloutActionResult> {
    const client = this.client(token);
    const res = await client.GET(
      '/api/v1/namespaces/{namespaceName}/endpointreleases/{endpointReleaseName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointReleaseName: request.releaseName,
          },
        },
      },
    );
    assertApiResponse(res, 'fetch endpoint release');
    const refs = new Map(
      (res.data.spec?.backendRefs ?? []).map(r => [r.name, r]),
    );
    const binding = await this.findBinding(
      client,
      request.namespaceName,
      request.endpointName,
      request.environment,
      request.projectName,
    );
    const current = binding?.spec?.backendOverrides ?? [];
    const weightOf = (name: string) =>
      current.find(o => o.name === name)?.weight ?? refs.get(name)?.weight ?? 1;
    const fits =
      current.every(o => refs.has(o.name)) &&
      [...refs.keys()].some(name => weightOf(name) > 0);
    const backendOverrides = fits
      ? current
          .map(({ mirror, ...o }) =>
            mirror && refs.get(o.name)?.mirror ? { ...o, mirror } : o,
          )
          .filter(o => o.weight !== undefined || 'mirror' in o)
      : [];
    return {
      latestRelease: request.releaseName,
      environments: await this.eachEnvironment([request.environment], env =>
        this.pinRelease(client, {
          namespaceName: request.namespaceName,
          projectName: request.projectName,
          endpointName: request.endpointName,
          environment: env,
          releaseName: request.releaseName,
          backendOverrides,
        }),
      ),
    };
  }

  /**
   * Turns a mirror rollout into a canary on the same backend: the mirror
   * goes and the testers header becomes its match, in one Endpoint change.
   * Its release starts the canary at 0% wherever it is deployed.
   */
  async convertRollout(
    request: ConvertRolloutRequest,
    token?: string,
  ): Promise<RolloutActionResult> {
    const client = this.client(token);
    const { endpoint, rollout } = await this.requireRollout(
      client,
      request.namespaceName,
      request.endpointName,
    );
    if (rollout.strategy !== 'mirror') {
      throw new InputError(
        `${request.endpointName} is running a ${rollout.strategy} rollout, not a mirror`,
      );
    }
    const converted = convertToCanary(
      toBackendWeights(endpoint.spec?.backendRefs),
      rollout,
      request.testerHeader,
    );
    validateMatches(converted.backends);
    const backendRefs = applyBackends(
      endpoint.spec?.backendRefs ?? [],
      converted.backends,
      { reach: true },
    );
    const previous = endpoint.status?.latestRelease?.name;
    await this.putEndpoint(
      client,
      request.namespaceName,
      {
        ...endpoint,
        metadata: {
          ...endpoint.metadata,
          annotations: {
            ...(endpoint.metadata.annotations ?? {}),
            [ROLLOUT_ANNOTATION]: serializeRollout(converted.rollout),
          },
        },
      },
      { ...endpoint.spec!, backendRefs },
    );
    const latestRelease = await this.waitForRelease(
      client,
      request.namespaceName,
      request.endpointName,
      previous,
    );
    return { ...(latestRelease && { latestRelease }), environments: [] };
  }
}

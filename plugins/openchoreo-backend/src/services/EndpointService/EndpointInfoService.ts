import { LoggerService } from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError } from '@backstage/errors';
import {
  createOpenChoreoApiClient,
  assertApiResponse,
} from '@openchoreo/openchoreo-client-node';
import {
  CHOREO_LABELS,
  buildComponentEndpoint,
  componentEndpointName,
  toDnsLabel,
  type APIResponse,
  type AllowedEndpointTypeEntry,
  type ComponentEndpointSummary,
  type EndpointTypeKind,
} from '@openchoreo/backstage-plugin-common';
import type { ApiSchemaResponse } from '../types';
import {
  isManagedBy,
  listComponentEndpoints,
  toComponentEndpointSummary,
  type ComponentRef,
} from './componentEndpoints';

export type EndpointReleaseSchemaSection = 'parameters' | 'environmentConfigs';

/**
 * BFF service for Endpoint reads beyond the catalog entity: the immutable
 * EndpointReleases the Endpoint controller cuts, and the parameter schemas of
 * (Cluster)EndpointTypes. Also manages a component's own Endpoints from its
 * configure page.
 */
export class EndpointInfoService {
  private logger: LoggerService;
  private baseUrl: string;

  constructor(logger: LoggerService, baseUrl: string) {
    this.logger = logger;
    this.baseUrl = baseUrl;
  }

  private client(token?: string) {
    return createOpenChoreoApiClient({
      baseUrl: this.baseUrl,
      token,
      logger: this.logger,
    });
  }

  private async getEndpointRelease(
    namespaceName: string,
    releaseName: string,
    token?: string,
  ): Promise<Record<string, unknown>> {
    const { data, error, response } = await this.client(token).GET(
      '/api/v1/namespaces/{namespaceName}/endpointreleases/{endpointReleaseName}',
      {
        params: {
          path: { namespaceName, endpointReleaseName: releaseName },
        },
      },
    );
    assertApiResponse({ data, error, response }, 'fetch endpoint release');
    return data as Record<string, unknown>;
  }

  /**
   * Returns the full EndpointRelease CR, so the Deploy tab can show the
   * snapshot pinned to an environment.
   */
  async fetchEndpointRelease(
    namespaceName: string,
    releaseName: string,
    token?: string,
  ): Promise<APIResponse & { data?: Record<string, unknown> }> {
    this.logger.debug(
      `Fetching endpoint release: ${releaseName} in namespace: ${namespaceName}`,
    );
    return {
      success: true,
      data: await this.getEndpointRelease(namespaceName, releaseName, token),
    };
  }

  /**
   * Returns one schema section from the EndpointType snapshot frozen on an
   * EndpointRelease, so per-environment overrides validate against what the
   * pinned release was cut against rather than the live type.
   */
  async fetchEndpointReleaseSchema(
    namespaceName: string,
    releaseName: string,
    section: EndpointReleaseSchemaSection,
    token?: string,
  ): Promise<ApiSchemaResponse> {
    const release = await this.getEndpointRelease(
      namespaceName,
      releaseName,
      token,
    );
    const spec = (release?.spec as Record<string, unknown>) || {};
    const endpointType = (spec.endpointType as Record<string, unknown>) || {};
    const typeSpec = (endpointType.spec as Record<string, unknown>) || {};
    const sectionBlock = typeSpec[section] as
      | { openAPIV3Schema?: Record<string, unknown> }
      | undefined;

    return {
      success: true,
      // Empty when the type declares no such section, so form code can
      // render its empty state without special-casing.
      data: (sectionBlock?.openAPIV3Schema ?? {}) as ApiSchemaResponse['data'],
    };
  }

  /** Returns the parameters schema of a namespace-scoped EndpointType. */
  async fetchEndpointTypeSchema(
    namespaceName: string,
    etName: string,
    token?: string,
  ): Promise<ApiSchemaResponse> {
    const { data, error, response } = await this.client(token).GET(
      '/api/v1/namespaces/{namespaceName}/endpointtypes/{etName}/schema',
      { params: { path: { namespaceName, etName } } },
    );
    assertApiResponse({ data, error, response }, 'fetch endpoint type schema');
    return { success: true, data: data as ApiSchemaResponse['data'] };
  }

  /** Returns the parameters schema of a ClusterEndpointType. */
  async fetchClusterEndpointTypeSchema(
    cetName: string,
    token?: string,
  ): Promise<ApiSchemaResponse> {
    const { data, error, response } = await this.client(token).GET(
      '/api/v1/clusterendpointtypes/{cetName}/schema',
      { params: { path: { cetName } } },
    );
    assertApiResponse(
      { data, error, response },
      'fetch cluster endpoint type schema',
    );
    return { success: true, data: data as ApiSchemaResponse['data'] };
  }

  /**
   * Returns a component's own Endpoints together with the allowedEndpoints of
   * its (Cluster)ComponentType, which decide what can still be added. A
   * ComponentType that cannot be read yields no allowedEndpoints rather than
   * an error, so existing Endpoints can still be edited.
   */
  async fetchComponentEndpoints(
    request: ComponentRef & {
      componentTypeKind: 'ComponentType' | 'ClusterComponentType';
      componentTypeName: string;
    },
    token?: string,
  ): Promise<{
    endpoints: ComponentEndpointSummary[];
    allowedEndpoints: AllowedEndpointTypeEntry[];
  }> {
    const client = this.client(token);
    const [endpoints, allowedEndpoints] = await Promise.all([
      listComponentEndpoints(client, request),
      this.fetchAllowedEndpoints(client, request),
    ]);
    return {
      endpoints: endpoints
        .map(toComponentEndpointSummary)
        .sort((a, b) => a.name.localeCompare(b.name)),
      allowedEndpoints,
    };
  }

  private async fetchAllowedEndpoints(
    client: ReturnType<EndpointInfoService['client']>,
    request: {
      namespaceName: string;
      componentTypeKind: 'ComponentType' | 'ClusterComponentType';
      componentTypeName: string;
    },
  ): Promise<AllowedEndpointTypeEntry[]> {
    const { namespaceName, componentTypeName } = request;
    const { data, error, response } =
      request.componentTypeKind === 'ClusterComponentType'
        ? await client.GET('/api/v1/clustercomponenttypes/{cctName}', {
            params: { path: { cctName: componentTypeName } },
          })
        : await client.GET(
            '/api/v1/namespaces/{namespaceName}/componenttypes/{ctName}',
            { params: { path: { namespaceName, ctName: componentTypeName } } },
          );
    if (error || !response.ok || !data) {
      this.logger.warn(
        `Could not read ${request.componentTypeKind} ${componentTypeName} for its allowedEndpoints: ${response.status}`,
      );
      return [];
    }
    return (data.spec?.allowedEndpoints ?? []) as AllowedEndpointTypeEntry[];
  }

  /**
   * Creates an Endpoint for one of a component's workload endpoints, named
   * and labeled as the component creation flow does. When the plain
   * `<component>-<endpoint>` name is taken, the EndpointType is appended, as
   * for a workload endpoint exposed through more than one type.
   */
  async createComponentEndpoint(
    request: ComponentRef & {
      workloadEndpoint: string;
      typeKind: EndpointTypeKind;
      typeName: string;
      visibility: string[];
      parameters?: Record<string, unknown>;
      autoDeploy: boolean;
    },
    token?: string,
  ): Promise<{ name: string }> {
    if (request.visibility.length === 0) {
      throw new InputError('An Endpoint needs at least one visibility');
    }
    const client = this.client(token);
    const names = [
      componentEndpointName(request.componentName, request.workloadEndpoint),
      componentEndpointName(
        request.componentName,
        request.workloadEndpoint,
        request.typeName,
      ),
    ];
    for (const [i, name] of names.entries()) {
      const { error, response } = await client.POST(
        '/api/v1/namespaces/{namespaceName}/endpoints',
        {
          params: { path: { namespaceName: request.namespaceName } },
          body: buildComponentEndpoint({ ...request, name }) as any,
        },
      );
      if (response.status === 409 && i < names.length - 1) {
        continue;
      }
      assertApiResponse(
        { data: undefined, error, response },
        'create component endpoint',
      );
      this.logger.info(
        `Created Endpoint ${name} (${request.typeKind} ${request.typeName}) for workload endpoint ${request.workloadEndpoint} of component ${request.componentName}`,
      );
      return { name };
    }
    // Unreachable: the last attempt either returns or throws.
    throw new Error('create component endpoint: no name left to try');
  }

  /**
   * Updates the visibility and parameters of one of a component's own
   * Endpoints, and points its backends at the renamed workload endpoint when
   * `workloadEndpoint` differs from the one it routes to. The type and owner
   * are immutable. Refuses Endpoints the component does not manage.
   */
  async updateComponentEndpoint(
    request: ComponentRef & {
      endpointName: string;
      visibility: string[];
      parameters?: Record<string, unknown>;
      workloadEndpoint?: string;
    },
    token?: string,
  ): Promise<ComponentEndpointSummary> {
    if (request.visibility.length === 0) {
      throw new InputError(
        'An Endpoint needs at least one visibility; delete it instead',
      );
    }
    const client = this.client(token);
    const endpoint = await this.getManagedEndpoint(client, request);
    const spec = endpoint.spec;
    const current = toComponentEndpointSummary(endpoint);
    const renameTo =
      request.workloadEndpoint &&
      request.workloadEndpoint !== current.workloadEndpoint
        ? request.workloadEndpoint
        : undefined;

    // Parameters are replaced as a whole, so a field cleared in the form is
    // dropped rather than kept from the old spec.
    const { parameters: _replaced, ...rest } = spec;
    const body = {
      metadata: {
        ...endpoint.metadata,
        ...(renameTo && {
          labels: {
            ...endpoint.metadata.labels,
            [CHOREO_LABELS.ENDPOINT_SOURCE_ENDPOINT]: toDnsLabel(renameTo),
          },
        }),
      },
      spec: {
        ...rest,
        visibility: request.visibility as typeof spec.visibility,
        ...(request.parameters &&
          Object.keys(request.parameters).length > 0 && {
            parameters: request.parameters,
          }),
        ...(renameTo && {
          backendRefs: spec.backendRefs.map(ref =>
            ref.component?.endpoint === current.workloadEndpoint
              ? { ...ref, component: { ...ref.component, endpoint: renameTo } }
              : ref,
          ),
        }),
      },
    };

    const { data, error, response } = await client.PUT(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointName: request.endpointName,
          },
        },
        body: body as any,
      },
    );
    assertApiResponse({ data, error, response }, 'update component endpoint');
    return toComponentEndpointSummary(data!);
  }

  /**
   * Deletes one of a component's own Endpoints. The Endpoint controller
   * removes its bindings, and so its routes, first. Refuses Endpoints the
   * component does not manage.
   */
  async deleteComponentEndpoint(
    request: ComponentRef & { endpointName: string },
    token?: string,
  ): Promise<{ success: true }> {
    const client = this.client(token);
    await this.getManagedEndpoint(client, request);
    const { error, response } = await client.DELETE(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointName: request.endpointName,
          },
        },
      },
    );
    assertApiResponse(
      { data: undefined, error, response },
      'delete component endpoint',
    );
    return { success: true };
  }

  /**
   * Adds a backend to an Endpoint, routing part of its traffic to another
   * component's workload endpoint. The Endpoint then belongs to its project:
   * the source-component and source-endpoint labels are dropped, so the
   * Endpoint controller re-parents it to the Project, the catalog lists it in
   * the project's contents, and the component's configure page and deploys
   * no longer manage it.
   */
  async addEndpointBackend(
    request: {
      namespaceName: string;
      endpointName: string;
      component: string;
      workloadEndpoint: string;
      weight?: number;
    },
    token?: string,
  ): Promise<{ name: string; backendName: string }> {
    const client = this.client(token);
    const { data, error, response } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointName: request.endpointName,
          },
        },
      },
    );
    assertApiResponse({ data, error, response }, 'fetch endpoint');
    const endpoint = data!;
    if (!endpoint.spec) {
      throw new InputError(`Endpoint ${request.endpointName} has no spec`);
    }
    const refs = endpoint.spec.backendRefs ?? [];
    if (
      refs.some(
        ref =>
          ref.component?.name === request.component &&
          ref.component?.endpoint === request.workloadEndpoint,
      )
    ) {
      throw new InputError(
        `Endpoint ${request.endpointName} already routes to ${request.component}/${request.workloadEndpoint}`,
      );
    }

    const base = toDnsLabel(
      `${request.component}-${request.workloadEndpoint}`,
    ).slice(0, 60);
    const taken = new Set(refs.map(ref => ref.name));
    let backendName = base;
    for (let i = 2; taken.has(backendName); i++) {
      backendName = `${base}-${i}`;
    }

    const {
      [CHOREO_LABELS.ENDPOINT_SOURCE_COMPONENT]: _component,
      [CHOREO_LABELS.ENDPOINT_SOURCE_ENDPOINT]: _endpoint,
      ...labels
    } = endpoint.metadata.labels ?? {};
    const body = {
      metadata: { ...endpoint.metadata, labels },
      spec: {
        ...endpoint.spec,
        backendRefs: [
          ...refs,
          {
            name: backendName,
            kind: 'Component',
            component: {
              name: request.component,
              endpoint: request.workloadEndpoint,
            },
            ...(request.weight !== undefined && { weight: request.weight }),
          },
        ],
      },
    };
    const updated = await client.PUT(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointName: request.endpointName,
          },
        },
        body: body as any,
      },
    );
    assertApiResponse(updated, 'add endpoint backend');
    return { name: request.endpointName, backendName };
  }

  private async getManagedEndpoint(
    client: ReturnType<EndpointInfoService['client']>,
    request: ComponentRef & { endpointName: string },
  ) {
    const { data, error, response } = await client.GET(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointName: request.endpointName,
          },
        },
      },
    );
    assertApiResponse({ data, error, response }, 'fetch endpoint');
    const endpoint = data!;
    if (
      !endpoint.spec ||
      endpoint.spec.owner.projectName !== request.projectName ||
      !isManagedBy(endpoint, request.componentName)
    ) {
      throw new NotAllowedError(
        `Endpoint ${request.endpointName} is not managed by component ${request.componentName}; change it from its project instead`,
      );
    }
    return { ...endpoint, spec: endpoint.spec };
  }
}

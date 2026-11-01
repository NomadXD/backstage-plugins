import {
  assertApiResponse,
  fetchAllPages,
  type createOpenChoreoApiClient,
  type OpenChoreoComponents,
} from '@openchoreo/openchoreo-client-node';
import {
  CHOREO_LABELS,
  endpointManagingComponent,
  endpointManagingReleaseLine,
  toStoredReleaseLine,
  type ComponentEndpointSummary,
} from '@openchoreo/backstage-plugin-common';

type OpenChoreoApiClient = ReturnType<typeof createOpenChoreoApiClient>;
type Endpoint = OpenChoreoComponents['schemas']['Endpoint'];

export interface ComponentRef {
  componentName: string;
  projectName: string;
  namespaceName: string;
  /**
   * The component's release line whose Endpoints are meant. Omitted or '' for
   * its main line.
   */
  releaseLine?: string;
}

/**
 * Lists the Endpoints created for a component's own workload endpoints on one
 * of its lines: labeled with it as source component, routing to nothing else,
 * and created for that line (main when request.releaseLine is unset). These
 * are the Endpoints the Endpoint controller makes the component own, so they
 * move between environments with it. An Endpoint later edited to route to
 * another component belongs to the project and is deployed on its own.
 */
export async function listComponentEndpoints(
  client: OpenChoreoApiClient,
  request: ComponentRef,
): Promise<Endpoint[]> {
  const items = await fetchAllPages(cursor =>
    client
      .GET('/api/v1/namespaces/{namespaceName}/endpoints', {
        params: {
          path: { namespaceName: request.namespaceName },
          query: {
            project: request.projectName,
            labelSelector: `${CHOREO_LABELS.ENDPOINT_SOURCE_COMPONENT}=${request.componentName}`,
            limit: 100,
            cursor,
          },
        },
      })
      .then(res => {
        assertApiResponse(res, 'fetch component endpoints');
        return res.data;
      }),
  );
  return items.filter(
    ep =>
      ep.spec?.owner?.projectName === request.projectName &&
      isManagedBy(ep, request.componentName, request.releaseLine),
  );
}

/**
 * Whether the component manages this Endpoint for the given line, main when
 * releaseLine is unset (see endpointManagingComponent and
 * endpointManagingReleaseLine).
 */
export function isManagedBy(
  endpoint: Endpoint,
  componentName: string,
  releaseLine?: string,
) {
  const ownership = {
    labels: endpoint.metadata.labels,
    backendRefs: endpoint.spec?.backendRefs,
  };
  return (
    endpointManagingComponent(ownership) === componentName &&
    endpointManagingReleaseLine(ownership) ===
      (toStoredReleaseLine(releaseLine) ?? '')
  );
}

/**
 * What the component's configure page shows of one of its Endpoints. The
 * workload endpoint is read from the backends, which all route to the
 * component (that is what makes it the component's), falling back to the
 * source-endpoint label.
 */
export function toComponentEndpointSummary(
  endpoint: Endpoint,
): ComponentEndpointSummary {
  const spec = endpoint.spec;
  const ready = endpoint.status?.conditions?.find(c => c.type === 'Ready');
  return {
    name: endpoint.metadata.name,
    releaseLine:
      endpointManagingReleaseLine({
        labels: endpoint.metadata.labels,
        backendRefs: spec?.backendRefs,
      }) ?? '',
    workloadEndpoint:
      spec?.backendRefs?.find(ref => ref.component?.endpoint)?.component
        ?.endpoint ??
      endpoint.metadata.labels?.[CHOREO_LABELS.ENDPOINT_SOURCE_ENDPOINT] ??
      '',
    typeKind:
      spec?.type?.kind === 'ClusterEndpointType'
        ? 'ClusterEndpointType'
        : 'EndpointType',
    typeName: spec?.type?.name ?? '',
    visibility: [...(spec?.visibility ?? [])],
    parameters: (spec?.parameters ?? {}) as Record<string, unknown>,
    autoDeploy: spec?.autoDeploy ?? false,
    ...(ready && {
      ready: {
        status: ready.status,
        reason: ready.reason,
        message: ready.message,
      },
    }),
    ...(endpoint.status?.latestRelease?.name && {
      latestRelease: endpoint.status.latestRelease.name,
    }),
  };
}

import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  createOpenChoreoApiClient,
  OpenChoreoComponents,
} from '@openchoreo/openchoreo-client-node';
import {
  translateEndpointToEntities,
  type ImmediateCatalogService,
} from '@openchoreo/backstage-plugin-catalog-backend-module';
import {
  CHOREO_LABELS,
  buildComponentEndpoint,
  componentEndpointName,
  planEndpointExposures,
  toDnsLabel,
  type EndpointExposures,
  type PlannedExposure,
} from '@openchoreo/backstage-plugin-common';

type OpenChoreoClient = ReturnType<typeof createOpenChoreoApiClient>;
type AllowedEndpointType =
  OpenChoreoComponents['schemas']['AllowedEndpointType'];

/**
 * Label marking an Endpoint as created for one component's workload endpoint.
 * While every backend of the Endpoint is that component, the Endpoint
 * controller makes the Component its owner, so deleting the component deletes
 * the Endpoint; otherwise the Project owns it.
 */
export const SOURCE_COMPONENT_LABEL = CHOREO_LABELS.ENDPOINT_SOURCE_COMPONENT;
/** Label naming the workload endpoint an Endpoint was created for. */
export const SOURCE_ENDPOINT_LABEL = CHOREO_LABELS.ENDPOINT_SOURCE_ENDPOINT;

/** The part of a workload endpoint that decides how it is exposed. */
export interface WorkloadEndpointLike {
  type: string;
  visibility?: string[];
}

/** One Endpoint to create for a workload endpoint of the new component. */
export interface PlannedEndpoint extends PlannedExposure {
  name: string;
}

/**
 * Decides which Endpoints a component needs from its workload endpoints, its
 * ComponentType's allowedEndpoints, and the developer's choices in the
 * creation form (see planEndpointExposures). Each Endpoint is named
 * `<component>-<endpoint>`, suffixed with the EndpointType when one workload
 * endpoint is exposed through more than one type.
 */
export function planComponentEndpoints(
  componentName: string,
  workloadEndpoints: Record<string, WorkloadEndpointLike>,
  allowedEndpoints: AllowedEndpointType[],
  exposures?: EndpointExposures,
): PlannedEndpoint[] {
  const planned = planEndpointExposures(
    workloadEndpoints,
    allowedEndpoints,
    exposures,
  );
  const perEndpoint = new Map<string, number>();
  for (const p of planned) {
    perEndpoint.set(
      p.workloadEndpoint,
      (perEndpoint.get(p.workloadEndpoint) ?? 0) + 1,
    );
  }
  return planned.map(p => {
    const split = (perEndpoint.get(p.workloadEndpoint) ?? 0) > 1;
    return {
      ...p,
      name: componentEndpointName(
        componentName,
        p.workloadEndpoint,
        split ? p.typeName : undefined,
      ),
    };
  });
}

export interface GenerateComponentEndpointsOptions {
  client: OpenChoreoClient;
  logger: LoggerService;
  namespaceName: string;
  projectName: string;
  componentName: string;
  componentTypeKind: 'ComponentType' | 'ClusterComponentType';
  componentTypeName: string;
  workloadEndpoints: Record<string, WorkloadEndpointLike>;
  /** The developer's EndpointType and parameter choices from the form. */
  exposures?: EndpointExposures;
  autoDeploy: boolean;
  insertEntity: ImmediateCatalogService['insertEntity'];
  defaultOwner: string;
}

/**
 * Creates the Endpoints a new component's workload endpoints call for, so a
 * developer declaring port, protocol and visibility gets the same one-step
 * exposure an Endpoint-backed ComponentType provides.
 *
 * Every failure is logged and skipped: the component and its workload already
 * exist, and an Endpoint can still be created from the project afterwards.
 * Returns the names of the Endpoints created.
 */
export async function generateComponentEndpoints(
  opts: GenerateComponentEndpointsOptions,
): Promise<string[]> {
  const { client, logger, namespaceName, projectName, componentName } = opts;

  const allowed = await fetchAllowedEndpoints(opts);
  if (allowed.length === 0) {
    return [];
  }

  const planned = planComponentEndpoints(
    componentName,
    opts.workloadEndpoints,
    allowed,
    opts.exposures,
  );
  const created: string[] = [];
  for (const endpoint of planned) {
    const backendName = toDnsLabel(componentName);
    const body = buildComponentEndpoint({
      name: endpoint.name,
      componentName,
      projectName,
      workloadEndpoint: endpoint.workloadEndpoint,
      typeKind: endpoint.typeKind,
      typeName: endpoint.typeName,
      visibility: endpoint.visibility,
      parameters: endpoint.parameters,
      autoDeploy: opts.autoDeploy,
    });

    const { error, response } = await client.POST(
      '/api/v1/namespaces/{namespaceName}/endpoints',
      {
        params: { path: { namespaceName } },
        body: body as any,
      },
    );
    if (error || !response.ok) {
      logger.warn(
        `Failed to create Endpoint '${endpoint.name}' for workload endpoint ` +
          `'${endpoint.workloadEndpoint}': ${response.status} ${JSON.stringify(
            error,
          )}. Create it from the project to expose the endpoint.`,
      );
      continue;
    }
    created.push(endpoint.name);
    logger.info(
      `Created Endpoint '${endpoint.name}' (${endpoint.typeKind} ${
        endpoint.typeName
      }, ${endpoint.visibility.join(', ')}) for workload endpoint '${
        endpoint.workloadEndpoint
      }'`,
    );

    try {
      const entities = translateEndpointToEntities(
        {
          name: endpoint.name,
          projectName,
          typeName: endpoint.typeName,
          typeKind: endpoint.typeKind,
          visibility: endpoint.visibility,
          backends: [
            {
              name: backendName,
              kind: 'Component',
              component: componentName,
              endpoint: endpoint.workloadEndpoint,
            },
          ],
          createdAt: new Date().toISOString(),
        },
        namespaceName,
        {
          locationKey: 'OpenChoreoEntityProvider',
          defaultOwner: `group:default/${opts.defaultOwner}`,
        },
      );
      for (const entity of entities) {
        await opts.insertEntity(entity);
      }
    } catch (catalogError) {
      logger.warn(
        `Failed to immediately add Endpoint '${endpoint.name}' to catalog: ${catalogError}. ` +
          `It will be visible after the next scheduled catalog sync.`,
      );
    }
  }
  return created;
}

async function fetchAllowedEndpoints(
  opts: GenerateComponentEndpointsOptions,
): Promise<AllowedEndpointType[]> {
  const { client, logger, namespaceName, componentTypeName } = opts;
  const { data, error, response } =
    opts.componentTypeKind === 'ClusterComponentType'
      ? await client.GET('/api/v1/clustercomponenttypes/{cctName}', {
          params: { path: { cctName: componentTypeName } },
        })
      : await client.GET(
          '/api/v1/namespaces/{namespaceName}/componenttypes/{ctName}',
          {
            params: { path: { namespaceName, ctName: componentTypeName } },
          },
        );
  if (error || !response.ok || !data) {
    logger.warn(
      `Could not read ${opts.componentTypeKind} '${componentTypeName}' to ` +
        `decide which Endpoints to create: ${response.status} ${JSON.stringify(
          error,
        )}. No Endpoints were created.`,
    );
    return [];
  }
  return data.spec?.allowedEndpoints ?? [];
}

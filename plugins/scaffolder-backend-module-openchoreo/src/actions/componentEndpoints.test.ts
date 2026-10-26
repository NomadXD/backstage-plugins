import {
  generateComponentEndpoints,
  planComponentEndpoints,
  SOURCE_COMPONENT_LABEL,
  SOURCE_ENDPOINT_LABEL,
} from './componentEndpoints';

const mockTranslate = jest.fn();
jest.mock('@openchoreo/backstage-plugin-catalog-backend-module', () => ({
  translateEndpointToEntities: (...args: any[]) => mockTranslate(...args),
}));

const http = {
  protocols: ['HTTP', 'GraphQL', 'Websocket'],
  visibilities: ['internal', 'namespace'] as (
    | 'namespace'
    | 'internal'
    | 'external'
  )[],
  ref: { kind: 'ClusterEndpointType' as const, name: 'http-route' },
  default: true,
};
const managed = {
  protocols: ['HTTP'],
  visibilities: ['external'] as ('namespace' | 'internal' | 'external')[],
  ref: { kind: 'ClusterEndpointType' as const, name: 'managed-api' },
  default: true,
};
const grpcOptIn = {
  protocols: ['gRPC'],
  visibilities: ['external'] as ('namespace' | 'internal' | 'external')[],
  ref: { kind: 'ClusterEndpointType' as const, name: 'grpc-route' },
};

describe('planComponentEndpoints', () => {
  it('creates one Endpoint per workload endpoint when its visibilities share a type', () => {
    expect(
      planComponentEndpoints(
        'orders',
        {
          api: {
            type: 'HTTP',
            visibility: ['project', 'internal', 'namespace'],
          },
        },
        [http],
      ),
    ).toEqual([
      {
        name: 'orders-api',
        workloadEndpoint: 'api',
        typeKind: 'ClusterEndpointType',
        typeName: 'http-route',
        visibility: ['internal', 'namespace'],
      },
    ]);
  });

  it('splits an endpoint whose visibilities map to different types', () => {
    const planned = planComponentEndpoints(
      'orders',
      { api: { type: 'HTTP', visibility: ['external', 'internal'] } },
      [http, managed],
    );
    expect(planned.map(p => [p.name, p.typeName, p.visibility])).toEqual([
      ['orders-api-managed-api', 'managed-api', ['external']],
      ['orders-api-http-route', 'http-route', ['internal']],
    ]);
  });

  it('skips visibilities and protocols without a default entry', () => {
    expect(
      planComponentEndpoints(
        'orders',
        {
          grpc: { type: 'gRPC', visibility: ['external'] },
          tcp: { type: 'TCP', visibility: ['internal'] },
          local: { type: 'HTTP' },
        },
        [http, grpcOptIn],
      ),
    ).toEqual([]);
  });

  it('defaults an entry without a ref kind to EndpointType', () => {
    const [planned] = planComponentEndpoints(
      'orders',
      { api: { type: 'HTTP', visibility: ['internal'] } },
      // The API server defaults kind; a raw object may still omit it.
      [{ ...http, ref: { name: 'ns-route' } as any }],
    );
    expect(planned.typeKind).toBe('EndpointType');
  });
});

describe('generateComponentEndpoints', () => {
  const buildClient = (spec: Record<string, unknown> | undefined) => {
    const GET = jest.fn().mockResolvedValue({
      data: spec ? { spec } : undefined,
      error: spec ? undefined : { message: 'not found' },
      response: { ok: !!spec, status: spec ? 200 : 404 },
    });
    const POST = jest.fn().mockResolvedValue({
      data: {},
      error: undefined,
      response: { ok: true, status: 201 },
    });
    return { client: { GET, POST } as any, GET, POST };
  };

  const baseOptions = (client: any) => ({
    client,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as any,
    namespaceName: 'acme',
    projectName: 'store',
    componentName: 'orders',
    componentTypeKind: 'ClusterComponentType' as const,
    componentTypeName: 'service',
    workloadEndpoints: {
      api: { type: 'HTTP', visibility: ['internal'] },
    },
    autoDeploy: true,
    insertEntity: jest.fn().mockResolvedValue(undefined),
    defaultOwner: 'owners',
  });

  beforeEach(() => {
    mockTranslate.mockReset();
    mockTranslate.mockReturnValue([{ kind: 'Endpoint' }]);
  });

  it('creates labeled Endpoints that follow the component autoDeploy', async () => {
    const { client, GET, POST } = buildClient({ allowedEndpoints: [http] });
    const opts = baseOptions(client);

    await expect(generateComponentEndpoints(opts)).resolves.toEqual([
      'orders-api',
    ]);

    expect(GET).toHaveBeenCalledWith(
      '/api/v1/clustercomponenttypes/{cctName}',
      {
        params: { path: { cctName: 'service' } },
      },
    );
    expect(POST).toHaveBeenCalledWith(
      '/api/v1/namespaces/{namespaceName}/endpoints',
      {
        params: { path: { namespaceName: 'acme' } },
        body: {
          metadata: {
            name: 'orders-api',
            labels: {
              [SOURCE_COMPONENT_LABEL]: 'orders',
              [SOURCE_ENDPOINT_LABEL]: 'api',
            },
          },
          spec: {
            owner: { projectName: 'store' },
            type: { kind: 'ClusterEndpointType', name: 'http-route' },
            visibility: ['internal'],
            backendRefs: [
              {
                name: 'orders',
                kind: 'Component',
                component: { name: 'orders', endpoint: 'api' },
              },
            ],
            autoDeploy: true,
          },
        },
      },
    );
    expect(opts.insertEntity).toHaveBeenCalledWith({ kind: 'Endpoint' });
  });

  it('creates nothing when the ComponentType has no allowedEndpoints', async () => {
    const { client, POST } = buildClient({});
    await expect(
      generateComponentEndpoints(baseOptions(client)),
    ).resolves.toEqual([]);
    expect(POST).not.toHaveBeenCalled();
  });

  it('creates nothing and does not throw when the ComponentType cannot be read', async () => {
    const { client, POST } = buildClient(undefined);
    await expect(
      generateComponentEndpoints(baseOptions(client)),
    ).resolves.toEqual([]);
    expect(POST).not.toHaveBeenCalled();
  });

  it('uses the developer choices and parameters from the form', async () => {
    const { client, POST } = buildClient({
      allowedEndpoints: [http, { ...managed, default: false }],
    });
    const opts = {
      ...baseOptions(client),
      workloadEndpoints: {
        api: { type: 'HTTP', visibility: ['external', 'internal'] },
        admin: { type: 'HTTP', visibility: ['internal'] },
      },
      exposures: {
        api: {
          types: {
            external: 'ClusterEndpointType/managed-api',
            internal: 'ClusterEndpointType/http-route',
          },
          parameters: {
            'ClusterEndpointType/managed-api': { plan: 'gold' },
          },
        },
        admin: { types: { internal: 'none' } },
      },
    };

    await expect(generateComponentEndpoints(opts)).resolves.toEqual([
      'orders-api-managed-api',
      'orders-api-http-route',
    ]);
    const bodies = POST.mock.calls.map(c => c[1].body);
    expect(bodies[0].spec).toMatchObject({
      type: { kind: 'ClusterEndpointType', name: 'managed-api' },
      visibility: ['external'],
      parameters: { plan: 'gold' },
    });
    expect(bodies[1].spec).toMatchObject({
      type: { kind: 'ClusterEndpointType', name: 'http-route' },
      visibility: ['internal'],
    });
    expect(bodies[1].spec.parameters).toBeUndefined();
  });

  it('skips an Endpoint the API rejects and keeps going', async () => {
    const { client, POST } = buildClient({ allowedEndpoints: [http] });
    POST.mockResolvedValueOnce({
      data: undefined,
      error: { message: 'conflict' },
      response: { ok: false, status: 409 },
    });
    const opts = {
      ...baseOptions(client),
      workloadEndpoints: {
        api: { type: 'HTTP', visibility: ['internal'] },
        admin: { type: 'HTTP', visibility: ['namespace'] },
      },
    };

    await expect(generateComponentEndpoints(opts)).resolves.toEqual([
      'orders-admin',
    ]);
    expect(POST).toHaveBeenCalledTimes(2);
  });
});

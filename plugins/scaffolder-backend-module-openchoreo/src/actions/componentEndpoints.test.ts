import {
  createComponentEndpoints,
  fetchAllowedEndpoints,
  planComponentEndpoints,
  SOURCE_COMPONENT_LABEL,
  SOURCE_ENDPOINT_LABEL,
} from './componentEndpoints';

const mockTranslate = jest.fn();
jest.mock('@openchoreo/backstage-plugin-catalog-backend-module', () => ({
  translateEndpointToEntities: (...args: any[]) => mockTranslate(...args),
}));

const http = {
  protocols: ['HTTP', 'GraphQL', 'Websocket'] as any,
  ref: { kind: 'ClusterEndpointType' as const, name: 'http-route' },
  default: true,
};
const managed = {
  name: 'managed',
  protocols: ['HTTP'] as any,
  ref: { kind: 'ClusterEndpointType' as const, name: 'managed-http' },
};

const logger = () =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  } as any);

describe('planComponentEndpoints', () => {
  it('plans one Endpoint per exposed workload endpoint, named after it', () => {
    expect(
      planComponentEndpoints(
        'orders',
        {
          api: { protocol: 'HTTP', visibility: ['external', 'internal'] },
          admin: { type: 'HTTP', visibility: ['project'] },
        },
        [http, managed],
      ),
    ).toEqual([
      {
        name: 'orders-api',
        workloadEndpoint: 'api',
        typeKind: 'ClusterEndpointType',
        typeName: 'http-route',
        visibility: ['external', 'internal'],
      },
    ]);
  });

  it('uses the developer choices and parameters from the form', () => {
    expect(
      planComponentEndpoints(
        'orders',
        {
          api: { protocol: 'HTTP', visibility: ['external'] },
          web: { protocol: 'HTTP', visibility: ['external'] },
        },
        [http, managed],
        {
          api: {
            type: 'ClusterEndpointType/managed-http',
            parameters: { requireApiKey: true },
          },
          web: { type: 'none' },
        },
      ),
    ).toEqual([
      {
        name: 'orders-api',
        workloadEndpoint: 'api',
        typeKind: 'ClusterEndpointType',
        typeName: 'managed-http',
        visibility: ['external'],
        parameters: { requireApiKey: true },
      },
    ]);
  });
});

describe('fetchAllowedEndpoints', () => {
  const opts = (GET: jest.Mock) => ({
    client: { GET } as any,
    logger: logger(),
    namespaceName: 'acme',
    componentTypeKind: 'ClusterComponentType' as const,
    componentTypeName: 'service',
  });

  it('reads the ComponentType allowedEndpoints', async () => {
    const GET = jest.fn().mockResolvedValue({
      data: { spec: { allowedEndpoints: [http] } },
      response: { ok: true, status: 200 },
    });
    await expect(fetchAllowedEndpoints(opts(GET))).resolves.toEqual([http]);
    expect(GET).toHaveBeenCalledWith(
      '/api/v1/clustercomponenttypes/{cctName}',
      {
        params: { path: { cctName: 'service' } },
      },
    );
  });

  it('returns none, without throwing, when the type cannot be read', async () => {
    const GET = jest.fn().mockResolvedValue({
      error: { message: 'not found' },
      response: { ok: false, status: 404 },
    });
    await expect(fetchAllowedEndpoints(opts(GET))).resolves.toEqual([]);
  });
});

describe('createComponentEndpoints', () => {
  const planned = [
    {
      name: 'orders-api',
      workloadEndpoint: 'api',
      typeKind: 'ClusterEndpointType' as const,
      typeName: 'http-route',
      visibility: ['internal'],
    },
  ];
  const baseOptions = (POST: jest.Mock) => ({
    client: { POST } as any,
    logger: logger(),
    namespaceName: 'acme',
    projectName: 'store',
    componentName: 'orders',
    planned,
    autoDeploy: true,
    insertEntity: jest.fn().mockResolvedValue(undefined),
    defaultOwner: 'owners',
  });

  beforeEach(() => {
    mockTranslate.mockReset();
    mockTranslate.mockReturnValue([{ kind: 'Endpoint' }]);
  });

  it('creates labeled Endpoints that follow the component autoDeploy', async () => {
    const POST = jest.fn().mockResolvedValue({
      data: {},
      response: { ok: true, status: 201 },
    });
    const opts = baseOptions(POST);

    await expect(createComponentEndpoints(opts)).resolves.toEqual([
      'orders-api',
    ]);
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

  it('skips an Endpoint the API rejects and keeps going', async () => {
    const POST = jest.fn().mockResolvedValue({
      error: { message: 'conflict' },
      response: { ok: false, status: 409 },
    });
    await expect(createComponentEndpoints(baseOptions(POST))).resolves.toEqual(
      [],
    );
  });
});

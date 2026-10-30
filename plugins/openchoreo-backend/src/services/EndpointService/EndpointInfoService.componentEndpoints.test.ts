import { mockServices } from '@backstage/backend-test-utils';
import { createOkResponse, createErrorResponse } from '@openchoreo/test-utils';
import { EndpointInfoService } from './EndpointInfoService';

const mockGET = jest.fn();
const mockPOST = jest.fn();
const mockPUT = jest.fn();
const mockDELETE = jest.fn();

jest.mock('@openchoreo/openchoreo-client-node', () => ({
  ...jest.requireActual('@openchoreo/openchoreo-client-node'),
  createOpenChoreoApiClient: jest.fn(() => ({
    GET: mockGET,
    POST: mockPOST,
    PUT: mockPUT,
    DELETE: mockDELETE,
  })),
  fetchAllPages: jest.fn((fetchPage: (cursor?: string) => Promise<any>) =>
    fetchPage(undefined).then((page: any) => page.items),
  ),
}));

const ref = {
  componentName: 'orders',
  projectName: 'store',
  namespaceName: 'acme',
};

function endpoint(
  name: string,
  overrides: {
    component?: string;
    workloadEndpoint?: string;
    projectName?: string;
    parameters?: Record<string, unknown>;
  } = {},
) {
  return {
    metadata: {
      name,
      resourceVersion: '7',
      labels: {
        'openchoreo.dev/source-component': 'orders',
        'openchoreo.dev/source-endpoint': overrides.workloadEndpoint ?? 'api',
      },
    },
    spec: {
      owner: { projectName: overrides.projectName ?? 'store' },
      type: { kind: 'ClusterEndpointType', name: 'http-route' },
      visibility: ['external'],
      backendRefs: [
        {
          name: 'orders',
          kind: 'Component',
          weight: 1,
          component: {
            name: overrides.component ?? 'orders',
            endpoint: overrides.workloadEndpoint ?? 'api',
          },
        },
      ],
      ...(overrides.parameters && { parameters: overrides.parameters }),
      autoDeploy: true,
    },
    status: {
      conditions: [{ type: 'Ready', status: 'True', reason: 'Ready' }],
      latestRelease: { name: `${name}-abc`, hash: 'abc' },
    },
  };
}

describe('EndpointInfoService component Endpoints', () => {
  let service: EndpointInfoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EndpointInfoService(mockServices.logger.mock(), 'http://api');
  });

  describe('fetchComponentEndpoints', () => {
    it('returns the component-managed Endpoints and allowedEndpoints', async () => {
      const allowed = [
        {
          protocols: ['HTTP'],
          visibilities: ['external'],
          ref: { kind: 'ClusterEndpointType', name: 'http-route' },
          default: true,
        },
      ];
      mockGET.mockImplementation((path: string) =>
        Promise.resolve(
          path.endsWith('/endpoints')
            ? createOkResponse({
                items: [
                  endpoint('orders-api', { parameters: { host: 'a' } }),
                  // Routes to another component too: owned by the project.
                  endpoint('orders-shared', { component: 'payments' }),
                ],
              })
            : createOkResponse({ spec: { allowedEndpoints: allowed } }),
        ),
      );

      const result = await service.fetchComponentEndpoints({
        ...ref,
        componentTypeKind: 'ClusterComponentType',
        componentTypeName: 'service',
      });

      expect(result.allowedEndpoints).toEqual(allowed);
      expect(result.endpoints).toEqual([
        {
          name: 'orders-api',
          workloadEndpoint: 'api',
          typeKind: 'ClusterEndpointType',
          typeName: 'http-route',
          visibility: ['external'],
          parameters: { host: 'a' },
          autoDeploy: true,
          ready: { status: 'True', reason: 'Ready', message: undefined },
          latestRelease: 'orders-api-abc',
        },
      ]);
      expect(mockGET).toHaveBeenCalledWith(
        '/api/v1/namespaces/{namespaceName}/endpoints',
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({
              labelSelector: 'openchoreo.dev/source-component=orders',
            }),
          }),
        }),
      );
      expect(mockGET).toHaveBeenCalledWith(
        '/api/v1/clustercomponenttypes/{cctName}',
        { params: { path: { cctName: 'service' } } },
      );
    });

    it('still returns the Endpoints when the ComponentType cannot be read', async () => {
      mockGET.mockImplementation((path: string) =>
        Promise.resolve(
          path.endsWith('/endpoints')
            ? createOkResponse({ items: [endpoint('orders-api')] })
            : createErrorResponse(404, 'not found'),
        ),
      );

      const result = await service.fetchComponentEndpoints({
        ...ref,
        componentTypeKind: 'ComponentType',
        componentTypeName: 'service',
      });

      expect(result.allowedEndpoints).toEqual([]);
      expect(result.endpoints.map(e => e.name)).toEqual(['orders-api']);
    });
  });

  describe('createComponentEndpoint', () => {
    const request = {
      ...ref,
      workloadEndpoint: 'api',
      typeKind: 'ClusterEndpointType' as const,
      typeName: 'managed-http',
      visibility: ['external'],
      parameters: { requireApiKey: true },
      autoDeploy: false,
    };

    it('creates a labeled Endpoint named after the workload endpoint', async () => {
      mockPOST.mockResolvedValue(createOkResponse({}));

      await expect(service.createComponentEndpoint(request)).resolves.toEqual({
        name: 'orders-api',
      });
      expect(mockPOST).toHaveBeenCalledWith(
        '/api/v1/namespaces/{namespaceName}/endpoints',
        {
          params: { path: { namespaceName: 'acme' } },
          body: expect.objectContaining({
            metadata: {
              name: 'orders-api',
              labels: {
                'openchoreo.dev/source-component': 'orders',
                'openchoreo.dev/source-endpoint': 'api',
              },
            },
            spec: expect.objectContaining({
              type: { kind: 'ClusterEndpointType', name: 'managed-http' },
              parameters: { requireApiKey: true },
              autoDeploy: false,
            }),
          }),
        },
      );
    });

    it('appends the EndpointType when the plain name is taken', async () => {
      mockPOST
        .mockResolvedValueOnce(createErrorResponse(409, 'exists'))
        .mockResolvedValueOnce(createOkResponse({}));

      await expect(service.createComponentEndpoint(request)).resolves.toEqual({
        name: 'orders-api-managed-http',
      });
    });

    it('fails when both names are taken', async () => {
      mockPOST.mockResolvedValue(createErrorResponse(409, 'exists'));

      await expect(service.createComponentEndpoint(request)).rejects.toThrow();
      expect(mockPOST).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateComponentEndpoint', () => {
    it('replaces visibility and parameters, keeping the rest', async () => {
      const current = endpoint('orders-api', { parameters: { host: 'a' } });
      mockGET.mockResolvedValue(createOkResponse(current));
      mockPUT.mockImplementation((_path: string, { body }: any) =>
        Promise.resolve(createOkResponse(body)),
      );

      const saved = await service.updateComponentEndpoint({
        ...ref,
        endpointName: 'orders-api',
        visibility: ['external', 'internal'],
        parameters: {},
      });

      const body = mockPUT.mock.calls[0][1].body;
      expect(body).not.toHaveProperty('status');
      expect(body.metadata).toEqual(current.metadata);
      expect(body.spec).toEqual({
        ...current.spec,
        visibility: ['external', 'internal'],
        parameters: undefined,
      });
      expect(body.spec).not.toHaveProperty('parameters');
      expect(saved.visibility).toEqual(['external', 'internal']);
    });

    it('follows a renamed workload endpoint', async () => {
      mockGET.mockResolvedValue(createOkResponse(endpoint('orders-api')));
      mockPUT.mockImplementation((_path: string, { body }: any) =>
        Promise.resolve(createOkResponse(body)),
      );

      const saved = await service.updateComponentEndpoint({
        ...ref,
        endpointName: 'orders-api',
        visibility: ['external'],
        workloadEndpoint: 'http',
      });

      const body = mockPUT.mock.calls[0][1].body;
      expect(body.metadata.labels['openchoreo.dev/source-endpoint']).toBe(
        'http',
      );
      expect(body.spec.backendRefs).toEqual([
        {
          name: 'orders',
          kind: 'Component',
          weight: 1,
          component: { name: 'orders', endpoint: 'http' },
        },
      ]);
      expect(saved.workloadEndpoint).toBe('http');
    });

    it('refuses an Endpoint the component does not manage', async () => {
      mockGET.mockResolvedValue(
        createOkResponse(endpoint('orders-api', { component: 'payments' })),
      );

      await expect(
        service.updateComponentEndpoint({
          ...ref,
          endpointName: 'orders-api',
          visibility: ['external'],
        }),
      ).rejects.toThrow(/not managed by component orders/);
      expect(mockPUT).not.toHaveBeenCalled();
    });

    it('refuses an empty visibility', async () => {
      await expect(
        service.updateComponentEndpoint({
          ...ref,
          endpointName: 'orders-api',
          visibility: [],
        }),
      ).rejects.toThrow(/at least one visibility/);
      expect(mockGET).not.toHaveBeenCalled();
    });
  });

  describe('deleteComponentEndpoint', () => {
    it('deletes an Endpoint the component manages', async () => {
      mockGET.mockResolvedValue(createOkResponse(endpoint('orders-api')));
      mockDELETE.mockResolvedValue(createOkResponse(undefined));

      await service.deleteComponentEndpoint({
        ...ref,
        endpointName: 'orders-api',
      });

      expect(mockDELETE).toHaveBeenCalledWith(
        '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
        {
          params: {
            path: { namespaceName: 'acme', endpointName: 'orders-api' },
          },
        },
      );
    });

    it('refuses an Endpoint of another project', async () => {
      mockGET.mockResolvedValue(
        createOkResponse(endpoint('orders-api', { projectName: 'other' })),
      );

      await expect(
        service.deleteComponentEndpoint({ ...ref, endpointName: 'orders-api' }),
      ).rejects.toThrow(/not managed/);
      expect(mockDELETE).not.toHaveBeenCalled();
    });
  });

  describe('addEndpointBackend', () => {
    const request = {
      namespaceName: 'acme',
      endpointName: 'orders-api',
      component: 'payments',
      workloadEndpoint: 'http',
      weight: 2,
    };

    it('appends the backend and moves the Endpoint to its project', async () => {
      mockGET.mockResolvedValue(createOkResponse(endpoint('orders-api')));
      mockPUT.mockResolvedValue(createOkResponse({}));

      const result = await service.addEndpointBackend(request);

      expect(result).toEqual({
        name: 'orders-api',
        backendName: 'payments-http',
      });
      const body = mockPUT.mock.calls[0][1].body;
      expect(body.metadata.labels).toEqual({});
      expect(body.metadata.resourceVersion).toBe('7');
      expect(body.spec.backendRefs).toEqual([
        {
          name: 'orders',
          kind: 'Component',
          weight: 1,
          component: { name: 'orders', endpoint: 'api' },
        },
        {
          name: 'payments-http',
          kind: 'Component',
          weight: 2,
          component: { name: 'payments', endpoint: 'http' },
        },
      ]);
    });

    it('refuses a backend the Endpoint already routes to', async () => {
      mockGET.mockResolvedValue(createOkResponse(endpoint('orders-api')));

      await expect(
        service.addEndpointBackend({
          ...request,
          component: 'orders',
          workloadEndpoint: 'api',
        }),
      ).rejects.toThrow(/already routes to orders\/api/);
      expect(mockPUT).not.toHaveBeenCalled();
    });
  });

  describe('backend weight and removal', () => {
    const twoBackends = () => {
      const ep = endpoint('orders-api');
      ep.metadata.labels = {} as any;
      ep.spec.backendRefs.push({
        name: 'payments-http',
        kind: 'Component',
        weight: 1,
        component: { name: 'payments', endpoint: 'http' },
      });
      return ep;
    };
    const target = { namespaceName: 'acme', endpointName: 'orders-api' };

    it('sets the weight of one backend', async () => {
      mockGET.mockResolvedValue(createOkResponse(twoBackends()));
      mockPUT.mockResolvedValue(createOkResponse({}));

      await service.updateEndpointBackendWeight({
        ...target,
        backendName: 'payments-http',
        weight: 9,
      });

      const refs = mockPUT.mock.calls[0][1].body.spec.backendRefs;
      expect(refs.map((r: any) => [r.name, r.weight])).toEqual([
        ['orders', 1],
        ['payments-http', 9],
      ]);
    });

    it('removes a backend, keeping the labels as they are', async () => {
      const ep = endpoint('orders-api');
      ep.spec.backendRefs.push({
        name: 'payments-http',
        kind: 'Component',
        weight: 1,
        component: { name: 'payments', endpoint: 'http' },
      });
      mockGET.mockResolvedValue(createOkResponse(ep));
      mockPUT.mockResolvedValue(createOkResponse({}));

      await service.removeEndpointBackend({
        ...target,
        backendName: 'payments-http',
      });

      const body = mockPUT.mock.calls[0][1].body;
      expect(body.spec.backendRefs.map((r: any) => r.name)).toEqual(['orders']);
      expect(body.metadata.labels).toEqual(ep.metadata.labels);
    });

    it('refuses to remove the last backend', async () => {
      mockGET.mockResolvedValue(createOkResponse(endpoint('orders-api')));

      await expect(
        service.removeEndpointBackend({ ...target, backendName: 'orders' }),
      ).rejects.toThrow(/at least one backend/);
      expect(mockPUT).not.toHaveBeenCalled();
    });

    it('refuses an unknown backend', async () => {
      mockGET.mockResolvedValue(createOkResponse(twoBackends()));

      await expect(
        service.updateEndpointBackendWeight({
          ...target,
          backendName: 'nope',
          weight: 1,
        }),
      ).rejects.toThrow(/has no backend nope/);
    });

    it('refuses a backend past the CRD maximum of 16', async () => {
      const ep = endpoint('orders-api');
      for (let i = 1; i < 16; i++) {
        ep.spec.backendRefs.push({
          name: `b${i}`,
          kind: 'Component',
          weight: 1,
          component: { name: `c${i}`, endpoint: 'http' },
        });
      }
      mockGET.mockResolvedValue(createOkResponse(ep));

      await expect(
        service.addEndpointBackend({
          ...target,
          component: 'payments',
          workloadEndpoint: 'http',
        }),
      ).rejects.toThrow(/maximum of 16 backends/);
    });
  });
});

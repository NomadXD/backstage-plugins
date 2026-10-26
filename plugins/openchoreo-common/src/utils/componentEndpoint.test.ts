import {
  buildComponentEndpoint,
  componentEndpointName,
  toDnsLabel,
} from './componentEndpoint';

describe('toDnsLabel', () => {
  it('keeps valid short names', () => {
    expect(toDnsLabel('orders-api')).toBe('orders-api');
  });

  it('replaces invalid characters', () => {
    expect(toDnsLabel('Orders_API.v1')).toBe('orders-api-v1');
  });

  it('shortens long names with a stable hash', () => {
    const long = `${'a'.repeat(50)}-${'b'.repeat(30)}`;
    const label = toDnsLabel(long);
    expect(label).toHaveLength(63);
    expect(label).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
    expect(label).toBe(toDnsLabel(long));
    expect(label).not.toBe(toDnsLabel(`${long}c`));
  });
});

describe('componentEndpointName', () => {
  it('names the Endpoint after the component and workload endpoint', () => {
    expect(componentEndpointName('orders', 'api')).toBe('orders-api');
  });

  it('appends the EndpointType when asked', () => {
    expect(componentEndpointName('orders', 'api', 'managed-http')).toBe(
      'orders-api-managed-http',
    );
  });
});

describe('buildComponentEndpoint', () => {
  const input = {
    name: 'orders-api',
    componentName: 'orders',
    projectName: 'store',
    workloadEndpoint: 'api',
    typeKind: 'ClusterEndpointType' as const,
    typeName: 'http-route',
    visibility: ['external'],
    autoDeploy: true,
  };

  it('labels the Endpoint with its component and workload endpoint', () => {
    expect(buildComponentEndpoint(input)).toEqual({
      metadata: {
        name: 'orders-api',
        labels: {
          'openchoreo.dev/source-component': 'orders',
          'openchoreo.dev/source-endpoint': 'api',
        },
      },
      spec: {
        owner: { projectName: 'store' },
        type: { kind: 'ClusterEndpointType', name: 'http-route' },
        visibility: ['external'],
        backendRefs: [
          {
            name: 'orders',
            kind: 'Component',
            component: { name: 'orders', endpoint: 'api' },
          },
        ],
        autoDeploy: true,
      },
    });
  });

  it('carries parameters only when there are any', () => {
    expect(
      buildComponentEndpoint({ ...input, parameters: {} }).spec,
    ).not.toHaveProperty('parameters');
    expect(
      buildComponentEndpoint({ ...input, parameters: { host: 'a' } }).spec
        .parameters,
    ).toEqual({ host: 'a' });
  });
});

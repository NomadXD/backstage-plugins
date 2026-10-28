import {
  NO_ENDPOINT,
  defaultEndpointType,
  endpointProtocol,
  endpointTypeCandidates,
  planEndpointExposures,
  resolveEndpointType,
  workloadEndpointsForSave,
  type AllowedEndpointTypeEntry,
} from './endpointExposure';

const route: AllowedEndpointTypeEntry = {
  protocols: ['HTTP', 'GraphQL'],
  ref: { kind: 'ClusterEndpointType', name: 'http-route' },
  default: true,
};
const managed: AllowedEndpointTypeEntry = {
  name: 'managed',
  protocols: ['HTTP'],
  ref: { kind: 'ClusterEndpointType', name: 'managed-http' },
};
const grpc: AllowedEndpointTypeEntry = {
  protocols: ['gRPC'],
  ref: { kind: 'ClusterEndpointType', name: 'grpc-route' },
};
const entries = [managed, route, grpc];

describe('endpointProtocol', () => {
  it('prefers protocol and falls back to the deprecated type', () => {
    expect(endpointProtocol({ protocol: 'gRPC', type: 'HTTP' })).toBe('gRPC');
    expect(endpointProtocol({ type: 'HTTP' })).toBe('HTTP');
  });
});

describe('endpointTypeCandidates', () => {
  it('lists entries for the protocol, default first', () => {
    expect(
      endpointTypeCandidates('HTTP', entries).map(e => e.ref.name),
    ).toEqual(['http-route', 'managed-http']);
    expect(endpointTypeCandidates('TCP', entries)).toEqual([]);
  });
});

describe('defaultEndpointType', () => {
  it('returns the default entry, else the first allowed one, else none', () => {
    expect(defaultEndpointType('HTTP', entries)).toBe(
      'ClusterEndpointType/http-route',
    );
    expect(defaultEndpointType('gRPC', entries)).toBe(
      'ClusterEndpointType/grpc-route',
    );
    expect(defaultEndpointType('TCP', entries)).toBe(NO_ENDPOINT);
  });
});

describe('resolveEndpointType', () => {
  const http = { protocol: 'HTTP', visibility: ['external'] };

  it('keeps a valid choice, including none', () => {
    expect(
      resolveEndpointType(http, entries, {
        type: 'ClusterEndpointType/managed-http',
      }),
    ).toBe('ClusterEndpointType/managed-http');
    expect(resolveEndpointType(http, entries, { type: NO_ENDPOINT })).toBe(
      NO_ENDPOINT,
    );
  });

  it('falls back to the default when the choice no longer fits', () => {
    expect(
      resolveEndpointType(http, entries, {
        type: 'ClusterEndpointType/grpc-route',
      }),
    ).toBe('ClusterEndpointType/http-route');
  });
});

describe('planEndpointExposures', () => {
  it('plans one Endpoint per exposed workload endpoint', () => {
    expect(
      planEndpointExposures(
        {
          api: {
            protocol: 'HTTP',
            visibility: ['project', 'external', 'internal'],
          },
          admin: { protocol: 'HTTP', visibility: ['project'] },
          rpc: { protocol: 'gRPC', visibility: ['external'] },
          raw: { protocol: 'TCP', visibility: ['external'] },
        },
        entries,
        {
          api: {
            type: 'ClusterEndpointType/managed-http',
            parameters: { a: 1 },
          },
        },
      ),
    ).toEqual([
      {
        workloadEndpoint: 'api',
        typeKind: 'ClusterEndpointType',
        typeName: 'managed-http',
        visibility: ['external', 'internal'],
        parameters: { a: 1 },
      },
      {
        workloadEndpoint: 'rpc',
        typeKind: 'ClusterEndpointType',
        typeName: 'grpc-route',
        visibility: ['external'],
      },
    ]);
  });
});

describe('workloadEndpointsForSave', () => {
  it('drops visibility the Endpoint carries and sets protocol', () => {
    expect(
      workloadEndpointsForSave(
        {
          api: { type: 'HTTP', port: 80, visibility: ['project', 'external'] },
          legacy: { type: 'HTTP', port: 81, visibility: ['external'] },
        },
        ['api'],
      ),
    ).toEqual({
      api: {
        type: 'HTTP',
        protocol: 'HTTP',
        port: 80,
        visibility: ['project'],
      },
      legacy: {
        type: 'HTTP',
        protocol: 'HTTP',
        port: 81,
        visibility: ['external'],
      },
    });
  });
});

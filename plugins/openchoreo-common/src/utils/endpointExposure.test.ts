import {
  NO_ENDPOINT,
  endpointTypeCandidates,
  planEndpointExposures,
  resolveEndpointTypes,
  type AllowedEndpointTypeEntry,
} from './endpointExposure';

const http: AllowedEndpointTypeEntry = {
  protocols: ['HTTP', 'GraphQL', 'Websocket'],
  visibilities: ['internal', 'namespace'],
  ref: { kind: 'ClusterEndpointType', name: 'http-route' },
  default: true,
};
const managed: AllowedEndpointTypeEntry = {
  protocols: ['HTTP'],
  visibilities: ['external'],
  ref: { kind: 'ClusterEndpointType', name: 'managed-api' },
  default: true,
};
const plainExternal: AllowedEndpointTypeEntry = {
  name: 'web',
  protocols: ['HTTP'],
  visibilities: ['external', 'internal'],
  ref: { kind: 'ClusterEndpointType', name: 'http-route' },
};
const grpcOptIn: AllowedEndpointTypeEntry = {
  protocols: ['gRPC'],
  visibilities: ['external'],
  ref: { kind: 'ClusterEndpointType', name: 'grpc-route' },
};
const entries = [http, managed, plainExternal, grpcOptIn];

describe('endpointTypeCandidates', () => {
  it('lists defaults first and each type once', () => {
    expect(
      endpointTypeCandidates('HTTP', 'external', entries).map(e => e.ref.name),
    ).toEqual(['managed-api', 'http-route']);
    expect(
      endpointTypeCandidates('HTTP', 'internal', entries).map(e => e.ref.name),
    ).toEqual(['http-route']);
  });
});

describe('resolveEndpointTypes', () => {
  it('uses the default entry when nothing is chosen', () => {
    expect(
      resolveEndpointTypes(
        { type: 'HTTP', visibility: ['project', 'external', 'internal'] },
        entries,
      ),
    ).toEqual({
      external: 'ClusterEndpointType/managed-api',
      internal: 'ClusterEndpointType/http-route',
    });
  });

  it('keeps a valid choice, including no Endpoint, and drops an invalid one', () => {
    expect(
      resolveEndpointTypes(
        { type: 'HTTP', visibility: ['external', 'internal'] },
        entries,
        {
          types: {
            external: 'ClusterEndpointType/http-route',
            internal: 'ClusterEndpointType/grpc-route',
          },
        },
      ),
    ).toEqual({
      external: 'ClusterEndpointType/http-route',
      internal: 'ClusterEndpointType/http-route',
    });
    expect(
      resolveEndpointTypes(
        { type: 'HTTP', visibility: ['external'] },
        entries,
        {
          types: { external: NO_ENDPOINT },
        },
      ),
    ).toEqual({ external: NO_ENDPOINT });
  });

  it('creates no Endpoint where only opt-in entries match', () => {
    expect(
      resolveEndpointTypes({ type: 'gRPC', visibility: ['external'] }, entries),
    ).toEqual({ external: NO_ENDPOINT });
  });
});

describe('planEndpointExposures', () => {
  it('groups visibilities by type and attaches that type parameters', () => {
    expect(
      planEndpointExposures(
        { api: { type: 'HTTP', visibility: ['external', 'internal'] } },
        entries,
        {
          api: {
            types: {
              external: 'ClusterEndpointType/http-route',
              internal: 'ClusterEndpointType/http-route',
            },
            parameters: {
              'ClusterEndpointType/http-route': { pathPrefix: '/api' },
              'ClusterEndpointType/managed-api': { plan: 'gold' },
            },
          },
        },
      ),
    ).toEqual([
      {
        workloadEndpoint: 'api',
        typeKind: 'ClusterEndpointType',
        typeName: 'http-route',
        visibility: ['external', 'internal'],
        parameters: { pathPrefix: '/api' },
      },
    ]);
  });

  it('splits visibilities across types and skips no-Endpoint ones', () => {
    expect(
      planEndpointExposures(
        {
          api: { type: 'HTTP', visibility: ['external', 'internal'] },
          tcp: { type: 'TCP', visibility: ['internal'] },
          rpc: { type: 'gRPC', visibility: ['external'] },
        },
        entries,
      ).map(p => [p.workloadEndpoint, p.typeName, p.visibility]),
    ).toEqual([
      ['api', 'managed-api', ['external']],
      ['api', 'http-route', ['internal']],
    ]);
  });

  it('defaults a ref without kind to EndpointType', () => {
    const [planned] = planEndpointExposures(
      { api: { type: 'HTTP', visibility: ['internal'] } },
      [{ ...http, ref: { name: 'ns-route' } }],
    );
    expect(planned.typeKind).toBe('EndpointType');
  });
});

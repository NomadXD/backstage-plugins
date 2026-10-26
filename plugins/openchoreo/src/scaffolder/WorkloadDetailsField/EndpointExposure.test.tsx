import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import type { ReactNode } from 'react';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import {
  EndpointExposure,
  formExposures,
  useEndpointTypeSchemas,
} from './EndpointExposure';

const httpRoute = {
  protocols: ['HTTP'],
  visibilities: ['external', 'internal'],
  ref: { kind: 'ClusterEndpointType', name: 'http-route' },
  default: true,
};
const managed = {
  name: 'managed',
  protocols: ['HTTP'],
  visibilities: ['external'],
  ref: { kind: 'ClusterEndpointType', name: 'managed-api' },
};
const grpcOptIn = {
  protocols: ['gRPC'],
  visibilities: ['external'],
  ref: { kind: 'ClusterEndpointType', name: 'grpc-route' },
};

const HTTP_ROUTE = 'ClusterEndpointType/http-route';
const HTTP_ROUTE_SCHEMA = {
  type: 'object' as const,
  properties: {
    pathPrefix: { type: 'string' as const, default: '/', title: 'Path prefix' },
  },
};

describe('EndpointExposure', () => {
  it('shows the parameters directly when only one endpoint type matches', () => {
    render(
      <EndpointExposure
        endpoint={{ type: 'HTTP', visibility: ['project', 'internal'] }}
        allowedEndpoints={[httpRoute, managed]}
        schemas={{ [HTTP_ROUTE]: HTTP_ROUTE_SCHEMA }}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByText('EndpointType: http-route')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Parameters')).toBeInTheDocument();
    expect(screen.getByLabelText(/Path prefix/)).toBeInTheDocument();
  });

  it('offers a dropdown when several endpoint types match', async () => {
    const onChange = jest.fn();
    render(
      <EndpointExposure
        endpoint={{ type: 'HTTP', visibility: ['external'] }}
        allowedEndpoints={[httpRoute, managed]}
        schemas={{ [HTTP_ROUTE]: HTTP_ROUTE_SCHEMA }}
        onChange={onChange}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('button', { name: /http-route/ }));
    fireEvent.click(await screen.findByText('managed-api (managed)'));

    expect(onChange).toHaveBeenCalledWith({
      types: { external: 'ClusterEndpointType/managed-api' },
    });
  });

  it('names each endpoint type with its visibilities when several are in use', () => {
    render(
      <EndpointExposure
        endpoint={{ type: 'HTTP', visibility: ['external', 'internal'] }}
        allowedEndpoints={[httpRoute, managed]}
        choice={{
          types: {
            external: 'ClusterEndpointType/managed-api',
            internal: HTTP_ROUTE,
          },
        }}
        schemas={{
          [HTTP_ROUTE]: HTTP_ROUTE_SCHEMA,
          'ClusterEndpointType/managed-api': { type: 'object' },
        }}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByText('(external)')).toBeInTheDocument();
    expect(screen.getByText('(internal)')).toBeInTheDocument();
    // managed-api has no parameters, so only http-route's form shows.
    expect(screen.getAllByText('Parameters')).toHaveLength(1);
  });

  it('renders nothing for an endpoint with only project visibility', () => {
    const { container } = render(
      <EndpointExposure
        endpoint={{ type: 'HTTP', visibility: ['project'] }}
        allowedEndpoints={[httpRoute]}
        schemas={{}}
        onChange={jest.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('formExposures', () => {
  it('submits the single matching type even when it is not the default', () => {
    expect(
      formExposures(
        {
          rpc: { type: 'gRPC', visibility: ['external'] },
          local: { type: 'HTTP', visibility: ['project'] },
        },
        [httpRoute, grpcOptIn],
        {},
      ),
    ).toEqual({
      rpc: { types: { external: 'ClusterEndpointType/grpc-route' } },
    });
  });

  it('drops choices for removed endpoints and keeps parameters', () => {
    expect(
      formExposures(
        { api: { type: 'HTTP', visibility: ['internal'] } },
        [httpRoute],
        {
          api: {
            types: { internal: HTTP_ROUTE },
            parameters: { [HTTP_ROUTE]: { pathPrefix: '/api' } },
          },
          gone: { types: { internal: HTTP_ROUTE } },
        },
      ),
    ).toEqual({
      api: {
        types: { internal: HTTP_ROUTE },
        parameters: { [HTTP_ROUTE]: { pathPrefix: '/api' } },
      },
    });
  });
});

describe('useEndpointTypeSchemas', () => {
  it('loads each endpoint type schema once', async () => {
    const client = {
      fetchEndpointTypeParametersSchema: jest
        .fn()
        .mockResolvedValue({ success: true, data: HTTP_ROUTE_SCHEMA }),
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider apis={[[openChoreoClientApiRef, client as any]]}>
        {children}
      </TestApiProvider>
    );

    const { result, rerender } = renderHook(
      ({ keys }) => useEndpointTypeSchemas(keys, 'acme'),
      { wrapper, initialProps: { keys: [HTTP_ROUTE] } },
    );
    await waitFor(() =>
      expect(result.current[HTTP_ROUTE]).toEqual(HTTP_ROUTE_SCHEMA),
    );
    rerender({ keys: [HTTP_ROUTE] });

    expect(client.fetchEndpointTypeParametersSchema).toHaveBeenCalledTimes(1);
    expect(client.fetchEndpointTypeParametersSchema).toHaveBeenCalledWith(
      'ClusterEndpointType',
      'http-route',
      'acme',
    );
  });
});

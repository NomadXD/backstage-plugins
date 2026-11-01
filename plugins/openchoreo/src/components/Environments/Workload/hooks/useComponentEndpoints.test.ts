import { act, renderHook, waitFor } from '@testing-library/react';
import type { Entity } from '@backstage/catalog-model';
import {
  endpointTypeKey,
  type ComponentEndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import { useComponentEndpoints } from './useComponentEndpoints';

const client = {
  fetchComponentEndpoints: jest.fn(),
  createComponentEndpoint: jest.fn(),
  updateComponentEndpoint: jest.fn(),
  deleteComponentEndpoint: jest.fn(),
};

jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApi: () => client,
}));

const entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'orders' },
} as Entity;

const unmanagedHttp = { kind: 'ClusterEndpointType', name: 'unmanaged-http' };

function summary(
  name: string,
  workloadEndpoint: string,
): ComponentEndpointSummary {
  return {
    name,
    releaseLine: 'next',
    workloadEndpoint,
    typeKind: 'ClusterEndpointType',
    typeName: 'unmanaged-http',
    visibility: ['external'],
    parameters: {},
    autoDeploy: true,
  };
}

describe('useComponentEndpoints on a release line', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.fetchComponentEndpoints.mockResolvedValue({
      endpoints: [
        summary('orders-next-api', 'api'),
        summary('orders-next-old', 'old'),
      ],
      allowedEndpoints: [
        { protocols: ['HTTP'], ref: unmanagedHttp, default: true },
      ],
    });
    client.updateComponentEndpoint.mockImplementation(
      async (_e: Entity, name: string, update: { visibility: string[] }) => ({
        ...summary(name, 'api'),
        visibility: update.visibility,
      }),
    );
    client.deleteComponentEndpoint.mockResolvedValue(undefined);
    client.createComponentEndpoint.mockResolvedValue({
      name: 'orders-next-admin',
    });
  });

  it("loads and saves only the line's Endpoints", async () => {
    const { result } = renderHook(() =>
      useComponentEndpoints(entity, { releaseLine: 'next' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.fetchComponentEndpoints).toHaveBeenCalledWith(entity, 'next');

    // The api endpoint moves to internal, old is gone, and admin is new.
    const endpoints = {
      api: { protocol: 'HTTP', visibility: ['internal'] },
      admin: { protocol: 'HTTP', visibility: ['external'] },
    };
    act(() => {
      result.current.prepare(endpoints);
      result.current.setChoice('admin', {
        type: endpointTypeKey(unmanagedHttp),
      });
    });
    await act(() => result.current.apply(endpoints, true));

    expect(client.deleteComponentEndpoint).toHaveBeenCalledWith(
      entity,
      'orders-next-old',
      'next',
    );
    expect(client.updateComponentEndpoint).toHaveBeenCalledWith(
      entity,
      'orders-next-api',
      expect.objectContaining({ visibility: ['internal'] }),
      'next',
    );
    expect(client.createComponentEndpoint).toHaveBeenCalledWith(
      entity,
      expect.objectContaining({ workloadEndpoint: 'admin' }),
      'next',
    );
    expect(result.current.originals.map(o => [o.name, o.releaseLine])).toEqual([
      ['orders-next-api', 'next'],
      ['orders-next-admin', 'next'],
    ]);
  });

  it("loads the main line's Endpoints without a release line", async () => {
    const { result } = renderHook(() => useComponentEndpoints(entity));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.fetchComponentEndpoints).toHaveBeenCalledWith(
      entity,
      undefined,
    );
  });
});

import type { ComponentEndpointSummary } from '@openchoreo/backstage-plugin-common';
import {
  draftFromSummary,
  draftStatus,
  endpointChangeList,
  planEndpointChanges,
  type EndpointDraft,
} from './componentEndpointDrafts';

const summary = (
  overrides: Partial<ComponentEndpointSummary> = {},
): ComponentEndpointSummary => ({
  name: 'orders-api',
  workloadEndpoint: 'api',
  typeKind: 'ClusterEndpointType',
  typeName: 'http-route',
  visibility: ['external'],
  parameters: { host: 'a' },
  autoDeploy: true,
  ...overrides,
});

const workload = {
  api: { type: 'HTTP', visibility: ['external', 'internal'] },
};

describe('draftStatus', () => {
  it('keeps the visibilities the workload endpoint still has', () => {
    const draft = {
      ...draftFromSummary(summary()),
      visibility: ['external', 'namespace'],
    };
    expect(draftStatus(draft, workload)).toEqual({
      visibility: ['external'],
      dropped: ['namespace'],
    });
  });

  it('deletes an Endpoint whose workload endpoint is gone', () => {
    expect(draftStatus(draftFromSummary(summary()), {})).toEqual(
      expect.objectContaining({ deleteReason: 'workloadEndpointRemoved' }),
    );
  });

  it('deletes an Endpoint with no visibility left to serve', () => {
    expect(
      draftStatus(draftFromSummary(summary()), {
        api: { type: 'HTTP', visibility: ['project'] },
      }),
    ).toEqual(expect.objectContaining({ deleteReason: 'notExposed' }));
  });
});

describe('planEndpointChanges', () => {
  it('needs no call for unchanged Endpoints', () => {
    expect(
      planEndpointChanges([draftFromSummary(summary())], workload),
    ).toEqual([]);
  });

  it('orders deletes, then updates, then creates', () => {
    const added: EndpointDraft = {
      key: 'new:1',
      workloadEndpoint: 'api',
      typeKind: 'ClusterEndpointType',
      typeName: 'managed-http',
      visibility: ['internal'],
      parameters: {},
      deleted: false,
    };
    const updated = {
      ...draftFromSummary(summary({ name: 'orders-a' })),
      parameters: { host: 'b' },
    };
    const deleted = {
      ...draftFromSummary(summary({ name: 'orders-b' })),
      deleted: true,
    };

    expect(
      planEndpointChanges([added, updated, deleted], workload).map(c => [
        c.op,
        c.draft.key,
      ]),
    ).toEqual([
      ['delete', 'orders-b'],
      ['update', 'orders-a'],
      ['create', 'new:1'],
    ]);
  });

  it('updates an Endpoint whose workload endpoint was renamed', () => {
    const renamed = {
      ...draftFromSummary(summary()),
      workloadEndpoint: 'http',
    };
    const [change] = planEndpointChanges([renamed], {
      http: workload.api,
    });
    expect(change).toEqual(expect.objectContaining({ op: 'update' }));
  });

  it('drops an added Endpoint whose workload endpoint went away', () => {
    const added: EndpointDraft = {
      key: 'new:1',
      workloadEndpoint: 'gone',
      typeKind: 'EndpointType',
      typeName: 'http-route',
      visibility: ['external'],
      parameters: {},
      deleted: false,
    };
    expect(planEndpointChanges([added], workload)).toEqual([]);
  });
});

describe('endpointChangeList', () => {
  it('describes each change for the save confirmation', () => {
    const updated = {
      ...draftFromSummary(summary()),
      visibility: ['external', 'internal'],
      parameters: { host: 'b' },
    };
    const deleted = {
      ...draftFromSummary(summary({ name: 'orders-old' })),
      deleted: true,
    };
    expect(
      endpointChangeList(planEndpointChanges([updated, deleted], workload)),
    ).toEqual([
      { path: 'orders-old', type: 'removed', oldValue: 'Deleted' },
      {
        path: 'orders-api.visibility',
        type: 'modified',
        oldValue: 'external',
        newValue: 'external, internal',
      },
      expect.objectContaining({
        path: 'orders-api.parameters.host',
        type: 'modified',
        oldValue: 'a',
        newValue: 'b',
      }),
    ]);
  });
});

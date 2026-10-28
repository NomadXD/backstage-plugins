import type { ComponentEndpointSummary } from '@openchoreo/backstage-plugin-common';
import {
  endpointChangeList,
  exposedEndpointNames,
  planEndpointChanges,
  type EndpointPlanInput,
} from './componentEndpointDrafts';

const allowedEndpoints = [
  {
    protocols: ['HTTP'],
    ref: { kind: 'ClusterEndpointType', name: 'http-route' },
    default: true,
  },
  {
    protocols: ['HTTP'],
    ref: { kind: 'ClusterEndpointType', name: 'managed-http' },
  },
];
const ROUTE = 'ClusterEndpointType/http-route';
const MANAGED = 'ClusterEndpointType/managed-http';

const original = (
  overrides: Partial<ComponentEndpointSummary> = {},
): ComponentEndpointSummary => ({
  name: 'orders-api',
  workloadEndpoint: 'api',
  typeKind: 'ClusterEndpointType',
  typeName: 'http-route',
  visibility: ['external'],
  parameters: {},
  autoDeploy: true,
  ...overrides,
});

const input = (overrides: Partial<EndpointPlanInput>): EndpointPlanInput => ({
  endpoints: {},
  allowedEndpoints,
  choices: {},
  originals: [],
  renames: {},
  ...overrides,
});

const ops = (plan: ReturnType<typeof planEndpointChanges>) =>
  plan.map(c =>
    c.op === 'create'
      ? `create ${c.workloadEndpoint}`
      : `${c.op} ${c.original.name}`,
  );

describe('planEndpointChanges', () => {
  it('needs no call for an unchanged Endpoint', () => {
    expect(
      planEndpointChanges(
        input({
          endpoints: { api: { protocol: 'HTTP', visibility: ['external'] } },
          choices: { api: { type: ROUTE, parameters: {} } },
          originals: [original()],
        }),
      ),
    ).toEqual([]);
  });

  it('leaves a workload endpoint whose choice is none on the workload', () => {
    const plan = input({
      endpoints: { legacy: { type: 'HTTP', visibility: ['external'] } },
      choices: { legacy: { type: 'none' } },
    });
    expect(planEndpointChanges(plan)).toEqual([]);
    expect(exposedEndpointNames(plan)).toEqual([]);
  });

  it('creates an Endpoint when a type is chosen for a workload endpoint', () => {
    const plan = input({
      endpoints: {
        legacy: { type: 'HTTP', visibility: ['external', 'internal'] },
      },
      choices: {
        legacy: { type: MANAGED, parameters: { requireApiKey: true } },
      },
    });
    expect(planEndpointChanges(plan)).toEqual([
      {
        op: 'create',
        workloadEndpoint: 'legacy',
        typeKey: MANAGED,
        visibility: ['external', 'internal'],
        parameters: { requireApiKey: true },
      },
    ]);
    expect(exposedEndpointNames(plan)).toEqual(['legacy']);
  });

  it('replaces an Endpoint whose type changed, deleting first', () => {
    expect(
      ops(
        planEndpointChanges(
          input({
            endpoints: { api: { protocol: 'HTTP', visibility: ['external'] } },
            choices: { api: { type: MANAGED } },
            originals: [original()],
          }),
        ),
      ),
    ).toEqual(['delete orders-api', 'create api']);
  });

  it('deletes an Endpoint left with no visibility beyond project', () => {
    expect(
      ops(
        planEndpointChanges(
          input({
            endpoints: { api: { protocol: 'HTTP', visibility: ['project'] } },
            choices: { api: { type: ROUTE } },
            originals: [original()],
          }),
        ),
      ),
    ).toEqual(['delete orders-api']);
  });

  it('updates visibility, parameters and a renamed workload endpoint', () => {
    const [change] = planEndpointChanges(
      input({
        endpoints: {
          http: { protocol: 'HTTP', visibility: ['external', 'internal'] },
        },
        choices: { http: { type: ROUTE, parameters: { host: 'b' } } },
        originals: [original()],
        renames: { api: 'http' },
      }),
    );
    expect(change).toEqual(
      expect.objectContaining({
        op: 'update',
        workloadEndpoint: 'http',
        visibility: ['external', 'internal'],
        parameters: { host: 'b' },
      }),
    );
  });

  it('deletes the Endpoint of a removed workload endpoint', () => {
    expect(
      ops(planEndpointChanges(input({ originals: [original()] }))),
    ).toEqual(['delete orders-api']);
  });
});

describe('endpointChangeList', () => {
  it('describes each call for the save confirmation', () => {
    expect(
      endpointChangeList(
        planEndpointChanges(
          input({
            endpoints: {
              api: { protocol: 'HTTP', visibility: ['external', 'internal'] },
            },
            choices: { api: { type: ROUTE, parameters: {} } },
            originals: [original()],
          }),
        ),
      ),
    ).toEqual([
      {
        path: 'orders-api.visibility',
        type: 'modified',
        oldValue: 'external',
        newValue: 'external, internal',
      },
    ]);
  });
});

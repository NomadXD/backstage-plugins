/**
 * Building the Endpoint created for one workload endpoint of a component.
 *
 * Shared by the scaffolder action, which creates a component's Endpoints with
 * it, and the backend, which creates more of them later from the component's
 * configure page, so both name and label an Endpoint the same way.
 */
import { CHOREO_LABELS } from '../constants';
import type { EndpointTypeKind } from './endpointExposure';

const MAX_NAME_LENGTH = 63;

/** FNV-1a over the UTF-16 code units, as 8 hex digits. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Turns an arbitrary string into a DNS-1123 label, keeping it unique when it
 * has to be shortened by replacing the tail with a hash of the full value.
 */
export function toDnsLabel(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (cleaned.length <= MAX_NAME_LENGTH) {
    return cleaned;
  }
  const hash = shortHash(value);
  const head = cleaned
    .slice(0, MAX_NAME_LENGTH - hash.length - 1)
    .replace(/-$/, '');
  return `${head}-${hash}`;
}

/**
 * Name of the Endpoint for a component's workload endpoint:
 * `<component>-<endpoint>`, suffixed with the EndpointType when the workload
 * endpoint is exposed through more than one type.
 */
export function componentEndpointName(
  componentName: string,
  workloadEndpoint: string,
  typeName?: string,
): string {
  const base = `${componentName}-${workloadEndpoint}`;
  return toDnsLabel(typeName ? `${base}-${typeName}` : base);
}

/**
 * One of a component's own Endpoints as the backend hands it to the
 * component's configure page.
 */
export interface ComponentEndpointSummary {
  name: string;
  /** The workload endpoint of the component the Endpoint routes to. */
  workloadEndpoint: string;
  typeKind: EndpointTypeKind;
  typeName: string;
  visibility: string[];
  parameters: Record<string, unknown>;
  autoDeploy: boolean;
  /** The Endpoint's Ready condition, once the controller has set it. */
  ready?: { status: string; reason?: string; message?: string };
  latestRelease?: string;
}

/** What an Endpoint for a component's workload endpoint is made from. */
export interface ComponentEndpointInput {
  name: string;
  componentName: string;
  projectName: string;
  workloadEndpoint: string;
  typeKind: EndpointTypeKind;
  typeName: string;
  visibility: string[];
  parameters?: Record<string, unknown>;
  autoDeploy: boolean;
}

/**
 * The Endpoint resource for a component's workload endpoint, labeled with the
 * component and endpoint it was created for. While every backend of the
 * Endpoint is that component, the Endpoint controller makes the Component its
 * owner, so deleting the component deletes the Endpoint.
 */
export function buildComponentEndpoint(input: ComponentEndpointInput) {
  return {
    metadata: {
      name: input.name,
      labels: {
        [CHOREO_LABELS.ENDPOINT_SOURCE_COMPONENT]: input.componentName,
        [CHOREO_LABELS.ENDPOINT_SOURCE_ENDPOINT]: toDnsLabel(
          input.workloadEndpoint,
        ),
      },
    },
    spec: {
      owner: { projectName: input.projectName },
      type: { kind: input.typeKind, name: input.typeName },
      visibility: input.visibility,
      backendRefs: [
        {
          name: toDnsLabel(input.componentName),
          kind: 'Component' as const,
          component: {
            name: input.componentName,
            endpoint: input.workloadEndpoint,
          },
        },
      ],
      ...(input.parameters &&
        Object.keys(input.parameters).length > 0 && {
          parameters: input.parameters,
        }),
      autoDeploy: input.autoDeploy,
    },
  };
}

import { CHOREO_LABELS } from '../constants';

/** The parts of an OpenChoreo Endpoint the ownership rule reads. */
export interface EndpointOwnershipInput {
  labels?: Record<string, string>;
  backendRefs?: Array<{
    kind?: string;
    component?: { name?: string; releaseLine?: string };
  }>;
}

/**
 * Returns the component that manages an Endpoint, or undefined when the
 * Endpoint belongs to its project.
 *
 * Mirrors the openchoreo Endpoint controller's owner rule: an Endpoint labeled
 * with a source component whose backends all route to that component is owned
 * by the component. An Endpoint later edited to route anywhere else belongs to
 * the project again, so it is treated as project-scoped here too.
 */
export function endpointManagingComponent(
  endpoint: EndpointOwnershipInput,
): string | undefined {
  const component = endpoint.labels?.[CHOREO_LABELS.ENDPOINT_SOURCE_COMPONENT];
  const refs = endpoint.backendRefs ?? [];
  if (!component || refs.length === 0) {
    return undefined;
  }
  const routesOnlyToComponent = refs.every(
    ref =>
      (ref.kind ?? 'Component') === 'Component' &&
      ref.component?.name === component,
  );
  return routesOnlyToComponent ? component : undefined;
}

/**
 * Returns the release line of its managing component an Endpoint belongs to:
 * the line it was created for, from its source-release-line label, or '' for
 * the component's main line. Undefined when no component manages the Endpoint
 * (see endpointManagingComponent).
 *
 * The label, like the source-component label, records whose Endpoint it is:
 * a canary started from main's Endpoint by adding a backend on another line
 * stays main's, and the reverse.
 */
export function endpointManagingReleaseLine(
  endpoint: EndpointOwnershipInput,
): string | undefined {
  if (endpointManagingComponent(endpoint) === undefined) {
    return undefined;
  }
  return endpoint.labels?.[CHOREO_LABELS.ENDPOINT_SOURCE_RELEASE_LINE] ?? '';
}

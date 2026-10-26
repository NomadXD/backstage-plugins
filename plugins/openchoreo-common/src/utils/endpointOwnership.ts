import { CHOREO_LABELS } from '../constants';

/** The parts of an OpenChoreo Endpoint the ownership rule reads. */
export interface EndpointOwnershipInput {
  labels?: Record<string, string>;
  backendRefs?: Array<{
    kind?: string;
    component?: { name?: string };
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

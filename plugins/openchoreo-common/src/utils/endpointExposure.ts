/**
 * Choosing how a component's workload endpoints are exposed through
 * Endpoints, from its ComponentType's `allowedEndpoints`.
 *
 * Shared by the component creation form, which offers the choices, and the
 * scaffolder action, which creates the Endpoints, so both resolve a choice
 * the same way.
 */

/** An `allowedEndpoints` entry of a (Cluster)ComponentType. */
export interface AllowedEndpointTypeEntry {
  name?: string;
  protocols: string[];
  visibilities: string[];
  ref: { kind?: string; name: string };
  default?: boolean;
}

export type EndpointTypeKind = 'EndpointType' | 'ClusterEndpointType';

/** The part of a workload endpoint that decides how it can be exposed. */
export interface ExposableEndpoint {
  type: string;
  visibility?: string[];
}

/** Choice value meaning "create no Endpoint for this visibility". */
export const NO_ENDPOINT = 'none';

/**
 * What the developer chose for one workload endpoint: the EndpointType per
 * requested visibility (an entry key, or {@link NO_ENDPOINT}), and the
 * parameters per chosen EndpointType.
 */
export interface EndpointExposureChoice {
  types: Record<string, string>;
  parameters?: Record<string, Record<string, unknown>>;
}

/** Choices keyed by workload endpoint name. */
export type EndpointExposures = Record<string, EndpointExposureChoice>;

/** One Endpoint to create for a workload endpoint. */
export interface PlannedExposure {
  workloadEndpoint: string;
  typeKind: EndpointTypeKind;
  typeName: string;
  visibility: string[];
  parameters?: Record<string, unknown>;
}

/** Identifies the EndpointType an entry references. */
export function endpointTypeKey(ref: { kind?: string; name: string }): string {
  return `${ref.kind || 'EndpointType'}/${ref.name}`;
}

/**
 * The visibilities of a workload endpoint that an Endpoint can expose.
 * Project scope is implicit for every workload endpoint and never routed.
 */
export function exposableVisibilities(endpoint: ExposableEndpoint): string[] {
  return (endpoint.visibility ?? []).filter(v => v !== 'project');
}

/**
 * The entries that may expose a workload endpoint of this protocol at this
 * visibility, default entries first. Each EndpointType appears once.
 */
export function endpointTypeCandidates(
  protocol: string,
  visibility: string,
  entries: AllowedEndpointTypeEntry[],
): AllowedEndpointTypeEntry[] {
  const matching = entries.filter(
    e => e.protocols.includes(protocol) && e.visibilities.includes(visibility),
  );
  const ordered = [
    ...matching.filter(e => e.default),
    ...matching.filter(e => !e.default),
  ];
  const seen = new Set<string>();
  return ordered.filter(e => {
    const key = endpointTypeKey(e.ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Resolves the EndpointType per exposable visibility of a workload endpoint:
 * the developer's choice when it is still a valid candidate, otherwise the
 * default entry, otherwise no Endpoint.
 */
export function resolveEndpointTypes(
  endpoint: ExposableEndpoint,
  entries: AllowedEndpointTypeEntry[],
  choice?: EndpointExposureChoice,
): Record<string, string> {
  const types: Record<string, string> = {};
  for (const visibility of exposableVisibilities(endpoint)) {
    const candidates = endpointTypeCandidates(
      endpoint.type,
      visibility,
      entries,
    );
    const chosen = choice?.types?.[visibility];
    if (
      chosen === NO_ENDPOINT ||
      (chosen && candidates.some(c => endpointTypeKey(c.ref) === chosen))
    ) {
      types[visibility] = chosen;
      continue;
    }
    const fallback = candidates.find(c => c.default);
    types[visibility] = fallback ? endpointTypeKey(fallback.ref) : NO_ENDPOINT;
  }
  return types;
}

/**
 * Decides which Endpoints a component needs. Visibilities of one workload
 * endpoint that resolve to the same EndpointType become one Endpoint carrying
 * that type's parameters; visibilities resolving to no Endpoint stay with the
 * ComponentType's own routes.
 */
export function planEndpointExposures(
  endpoints: Record<string, ExposableEndpoint>,
  entries: AllowedEndpointTypeEntry[],
  exposures: EndpointExposures = {},
): PlannedExposure[] {
  const planned: PlannedExposure[] = [];
  for (const [name, endpoint] of Object.entries(endpoints)) {
    const choice = exposures[name];
    const types = resolveEndpointTypes(endpoint, entries, choice);
    const groups = new Map<string, string[]>();
    for (const [visibility, key] of Object.entries(types)) {
      if (key === NO_ENDPOINT) continue;
      groups.set(key, [...(groups.get(key) ?? []), visibility]);
    }
    for (const [key, visibility] of groups) {
      const slash = key.indexOf('/');
      const parameters = choice?.parameters?.[key];
      planned.push({
        workloadEndpoint: name,
        typeKind: key.slice(0, slash) as EndpointTypeKind,
        typeName: key.slice(slash + 1),
        visibility,
        ...(parameters && Object.keys(parameters).length > 0 && { parameters }),
      });
    }
  }
  return planned;
}

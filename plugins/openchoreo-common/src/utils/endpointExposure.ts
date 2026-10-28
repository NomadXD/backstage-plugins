/**
 * Choosing how a component's workload endpoints are exposed through
 * Endpoints, from its ComponentType's `allowedEndpoints`.
 *
 * Shared by the component creation form and configure page, which offer the
 * choices, and the scaffolder action, which creates the Endpoints, so all of
 * them resolve a choice the same way.
 *
 * The rule: a workload endpoint is exposed through an Endpoint when an
 * EndpointType is chosen for it. Its visibilities beyond project are then
 * carried by the Endpoint and dropped from the workload. Otherwise they stay
 * on the workload, in the deprecated field ComponentType templates still read.
 */
/** An `allowedEndpoints` entry of a (Cluster)ComponentType. */
export interface AllowedEndpointTypeEntry {
  name?: string;
  protocols: string[];
  ref: { kind?: string; name: string };
  default?: boolean;
}

export type EndpointTypeKind = 'EndpointType' | 'ClusterEndpointType';

/** The part of a workload endpoint that decides how it can be exposed. */
export interface ExposableEndpoint {
  protocol?: string;
  type?: string;
  visibility?: string[];
}

/** Choice value meaning "expose through no Endpoint". */
export const NO_ENDPOINT = 'none';

/**
 * What the developer chose for one workload endpoint: an EndpointType key, or
 * {@link NO_ENDPOINT}, and the parameters for that type.
 */
export interface EndpointExposureChoice {
  type: string;
  parameters?: Record<string, unknown>;
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

/** A workload endpoint's protocol, falling back to the deprecated type. */
export function endpointProtocol(endpoint: ExposableEndpoint): string {
  return endpoint.protocol || endpoint.type || '';
}

/** Identifies the EndpointType an entry references. */
export function endpointTypeKey(ref: { kind?: string; name: string }): string {
  return `${ref.kind || 'EndpointType'}/${ref.name}`;
}

/** Splits an EndpointType key back into kind and name. */
export function parseEndpointTypeKey(key: string): {
  kind: EndpointTypeKind;
  name: string;
} {
  const slash = key.indexOf('/');
  return {
    kind: key.slice(0, slash) as EndpointTypeKind,
    name: key.slice(slash + 1),
  };
}

/**
 * The visibilities of a workload endpoint that an Endpoint can expose.
 * Project scope is implicit for every workload endpoint and never routed.
 */
export function exposableVisibilities(endpoint: ExposableEndpoint): string[] {
  return (endpoint.visibility ?? []).filter(v => v !== 'project');
}

/**
 * The entries that may expose a workload endpoint of this protocol, default
 * entries first. Each EndpointType appears once.
 */
export function endpointTypeCandidates(
  protocol: string,
  entries: AllowedEndpointTypeEntry[],
): AllowedEndpointTypeEntry[] {
  const matching = entries.filter(e => e.protocols.includes(protocol));
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
 * The EndpointType key a protocol starts with: its default entry, otherwise
 * the first allowed one, or {@link NO_ENDPOINT} when none is allowed.
 */
export function defaultEndpointType(
  protocol: string,
  entries: AllowedEndpointTypeEntry[],
): string {
  const [first] = endpointTypeCandidates(protocol, entries);
  return first ? endpointTypeKey(first.ref) : NO_ENDPOINT;
}

/**
 * The EndpointType a workload endpoint is exposed through: the developer's
 * choice when it is still a candidate for the protocol (or "none"),
 * otherwise the protocol's default.
 */
export function resolveEndpointType(
  endpoint: ExposableEndpoint,
  entries: AllowedEndpointTypeEntry[],
  choice?: EndpointExposureChoice,
): string {
  const protocol = endpointProtocol(endpoint);
  const chosen = choice?.type;
  if (
    chosen === NO_ENDPOINT ||
    (chosen &&
      endpointTypeCandidates(protocol, entries).some(
        c => endpointTypeKey(c.ref) === chosen,
      ))
  ) {
    return chosen;
  }
  return defaultEndpointType(protocol, entries);
}

/**
 * Decides which Endpoints a component needs: one per workload endpoint that
 * has a visibility beyond project and an EndpointType, carrying those
 * visibilities and the chosen parameters.
 */
export function planEndpointExposures(
  endpoints: Record<string, ExposableEndpoint>,
  entries: AllowedEndpointTypeEntry[],
  exposures: EndpointExposures = {},
): PlannedExposure[] {
  const planned: PlannedExposure[] = [];
  for (const [name, endpoint] of Object.entries(endpoints)) {
    const visibility = exposableVisibilities(endpoint);
    if (visibility.length === 0) continue;
    const key = resolveEndpointType(endpoint, entries, exposures[name]);
    if (key === NO_ENDPOINT) continue;
    const { kind, name: typeName } = parseEndpointTypeKey(key);
    const parameters = exposures[name]?.parameters;
    planned.push({
      workloadEndpoint: name,
      typeKind: kind,
      typeName,
      visibility,
      ...(parameters && Object.keys(parameters).length > 0 && { parameters }),
    });
  }
  return planned;
}

/**
 * The workload endpoints to save: those exposed through an Endpoint lose
 * their visibilities beyond project, which the Endpoint carries instead.
 * Every endpoint gets `protocol` set alongside the deprecated type.
 */
export function workloadEndpointsForSave<
  T extends { protocol?: string; type?: string; visibility?: string[] },
>(
  endpoints: Record<string, T>,
  exposedThroughEndpoint: Iterable<string>,
): Record<string, T> {
  const exposed = new Set(exposedThroughEndpoint);
  const result: Record<string, T> = {};
  for (const [name, endpoint] of Object.entries(endpoints)) {
    const protocol = endpointProtocol(endpoint);
    const next: T = {
      ...endpoint,
      ...(protocol && { protocol, type: protocol }),
    };
    if (exposed.has(name)) {
      const kept = (endpoint.visibility ?? []).filter(v => v === 'project');
      if (kept.length > 0) {
        next.visibility = kept;
      } else {
        delete next.visibility;
      }
    }
    result[name] = next;
  }
  return result;
}

import { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { CHOREO_ANNOTATIONS } from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';

/** Visibilities an Endpoint can route to; project-only endpoints are refused. */
const ROUTABLE_VISIBILITIES = ['internal', 'external'];

/** A component workload endpoint an Endpoint can route to. */
export interface WorkloadEndpointOption {
  component: string;
  /** The component's release line; absent for its main line. */
  releaseLine?: string;
  endpoint: string;
  visibility: string[];
  /** Schema format, e.g. `openapi` or `proto`, when the endpoint has one. */
  schemaType?: string;
  /** Schema document, when the endpoint has one. */
  schemaContent?: string;
}

/**
 * Reads the project form value (`{ project_name, namespace_name }`) that
 * ProjectNamespaceField writes, stripping any entity-ref prefix.
 */
export function readProjectNamespace(
  formData: Record<string, any> | undefined,
  field: string,
): { project?: string; namespace?: string } {
  const value = formData?.[field] ?? {};
  const bare = (v: unknown) =>
    typeof v === 'string' && v ? v.split('/').pop() : undefined;
  return {
    project: bare(value.project_name),
    namespace: bare(value.namespace_name),
  };
}

/** Workload endpoint fields this field reads, as served by the BFF. */
interface WorkloadEndpointSpec {
  visibility?: string[];
  schema?: { type?: string; content?: string };
}

/**
 * Lists a component's workload endpoints from its Workload's
 * `spec.endpoints`. The Workload is the source of truth: endpoints without a
 * schema have no API entity in the catalog, so the catalog alone would miss
 * them.
 */
export function workloadEndpointOptions(
  component: string,
  endpoints: Record<string, WorkloadEndpointSpec> | undefined,
): WorkloadEndpointOption[] {
  return Object.entries(endpoints ?? {}).map(([endpoint, spec]) => ({
    component,
    endpoint,
    visibility: spec.visibility ?? [],
    ...(spec.schema?.content && {
      schemaType: spec.schema.type,
      schemaContent: spec.schema.content,
    }),
  }));
}

export function isRoutable(option: WorkloadEndpointOption): boolean {
  return option.visibility.some(v => ROUTABLE_VISIBILITIES.includes(v));
}

/**
 * Lists the workload endpoints of a project's components: the components come
 * from the catalog, their endpoints from each component's Workload. A
 * component without a Workload contributes no endpoints. With
 * includeReleaseLines, each release line's Workload contributes its endpoints
 * too, marked with the line.
 */
export function useProjectWorkloadEndpoints(
  namespace: string | undefined,
  project: string | undefined,
  { includeReleaseLines = false }: { includeReleaseLines?: boolean } = {},
): {
  options: WorkloadEndpointOption[];
  loading: boolean;
  error?: Error;
} {
  const catalogApi = useApi(catalogApiRef);
  const client = useApi(openChoreoClientApiRef);
  const [state, setState] = useState<{
    options: WorkloadEndpointOption[];
    loading: boolean;
    error?: Error;
  }>({ options: [], loading: false });

  useEffect(() => {
    if (!namespace || !project) {
      setState({ options: [], loading: false });
      return undefined;
    }
    let cancelled = false;
    setState(prev => ({ ...prev, loading: true, error: undefined }));
    catalogApi
      .getEntities({
        filter: {
          kind: 'Component',
          'metadata.namespace': namespace,
          [`metadata.annotations.${CHOREO_ANNOTATIONS.PROJECT}`]: project,
        },
      })
      .then(({ items }) =>
        Promise.all(
          items.map(async component => {
            const name =
              component.metadata.annotations?.[CHOREO_ANNOTATIONS.COMPONENT] ??
              component.metadata.name;
            const lineOptions = (releaseLine?: string) =>
              client
                .fetchWorkloadInfo(component, releaseLine)
                .then(workload =>
                  workloadEndpointOptions(
                    name,
                    workload?.spec?.endpoints as
                      | Record<string, WorkloadEndpointSpec>
                      | undefined,
                  ).map(o => (releaseLine ? { ...o, releaseLine } : o)),
                )
                // No Workload yet (or not readable): nothing to route to.
                .catch(() => [] as WorkloadEndpointOption[]);
            const lines = includeReleaseLines
              ? await client
                  .fetchReleaseLines(component)
                  .then(found => found.filter(l => !l.isMain).map(l => l.name))
                  .catch(() => [] as string[])
              : [];
            const perLine = await Promise.all([
              lineOptions(),
              ...lines.map(line => lineOptions(line)),
            ]);
            return perLine.flat();
          }),
        ),
      )
      .then(perComponent => {
        if (cancelled) return;
        const options = perComponent
          .flat()
          .sort((a, b) =>
            `${a.component}@${a.releaseLine ?? ''}/${a.endpoint}`.localeCompare(
              `${b.component}@${b.releaseLine ?? ''}/${b.endpoint}`,
            ),
          );
        setState({ options, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          options: [],
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [catalogApi, client, namespace, project, includeReleaseLines]);

  return state;
}

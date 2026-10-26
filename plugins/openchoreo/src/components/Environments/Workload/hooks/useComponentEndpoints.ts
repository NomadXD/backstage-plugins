import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Entity } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import {
  endpointTypeCandidates,
  endpointTypeKey,
  exposableVisibilities,
  type AllowedEndpointTypeEntry,
  type EndpointTypeKind,
  type ExposableEndpoint,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../../../api/OpenChoreoClientApi';
import { getErrorMessage } from '../../../../utils/errorUtils';
import {
  draftFromSummary,
  draftLabel,
  planEndpointChanges,
  type EndpointDraft,
} from '../componentEndpointDrafts';

export type EndpointDraftPatch = Partial<
  Pick<EndpointDraft, 'typeKind' | 'typeName' | 'visibility' | 'parameters'>
>;

export interface ComponentEndpointsState {
  loading: boolean;
  loadError: string | null;
  allowedEndpoints: AllowedEndpointTypeEntry[];
  drafts: EndpointDraft[];
  /** Whether the page shows Endpoints at all. */
  enabled: boolean;
  /** Whether an Endpoint card is open for editing. */
  isEditing: boolean;
  setEditing: (key: string, editing: boolean) => void;
  /**
   * Stages a new Endpoint for the workload endpoint's visibilities that no
   * Endpoint exposes yet, using the first allowed EndpointType. Returns its
   * key, or undefined when no type is allowed for them.
   */
  add: (
    workloadEndpoint: string,
    endpoint: ExposableEndpoint,
  ) => string | undefined;
  update: (key: string, patch: EndpointDraftPatch) => void;
  /** Drops an added Endpoint, or marks an existing one for deletion. */
  remove: (key: string) => void;
  undoRemove: (key: string) => void;
  /** Keeps Endpoints attached to a workload endpoint that was renamed. */
  renameWorkloadEndpoint: (from: string, to: string) => void;
  /**
   * Saves the staged changes. Each saved change becomes the new baseline, so
   * after a failure only what is left stays staged; the error names the
   * Endpoint that failed.
   */
  apply: (
    workloadEndpoints: Record<string, ExposableEndpoint>,
    autoDeploy: boolean,
  ) => Promise<void>;
}

const EMPTY: AllowedEndpointTypeEntry[] = [];

/** The visibilities of a workload endpoint no staged Endpoint covers. */
export function uncoveredVisibilities(
  workloadEndpoint: string,
  endpoint: ExposableEndpoint,
  drafts: EndpointDraft[],
): string[] {
  const covered = new Set(
    drafts
      .filter(d => d.workloadEndpoint === workloadEndpoint && !d.deleted)
      .flatMap(d => d.visibility),
  );
  return exposableVisibilities(endpoint).filter(v => !covered.has(v));
}

/** Loads a component's own Endpoints and stages edits to them. */
export function useComponentEndpoints(
  entity: Entity,
  options: { skip?: boolean } = {},
): ComponentEndpointsState {
  const client = useApi(openChoreoClientApiRef);
  const [loading, setLoading] = useState(!options.skip);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allowedEndpoints, setAllowedEndpoints] =
    useState<AllowedEndpointTypeEntry[]>(EMPTY);
  const [drafts, setDrafts] = useState<EndpointDraft[]>([]);
  const [editingKeys, setEditingKeys] = useState<string[]>([]);
  const nextKey = useRef(0);

  useEffect(() => {
    if (options.skip) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    client
      .fetchComponentEndpoints(entity)
      .then(result => {
        if (cancelled) return;
        setAllowedEndpoints(result.allowedEndpoints ?? EMPTY);
        setDrafts(result.endpoints.map(draftFromSummary));
        setLoadError(null);
      })
      .catch(e => {
        if (!cancelled) setLoadError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, entity, options.skip]);

  const setEditing = useCallback((key: string, editing: boolean) => {
    setEditingKeys(keys => {
      const without = keys.filter(k => k !== key);
      return editing ? [...without, key] : without;
    });
  }, []);

  const add = useCallback(
    (workloadEndpoint: string, endpoint: ExposableEndpoint) => {
      const uncovered = uncoveredVisibilities(
        workloadEndpoint,
        endpoint,
        drafts,
      );
      const entry = uncovered
        .map(v => endpointTypeCandidates(endpoint.type, v, allowedEndpoints))
        .find(candidates => candidates.length > 0)?.[0];
      if (!entry) return undefined;
      const typeKey = endpointTypeKey(entry.ref);
      const visibility = uncovered.filter(v =>
        endpointTypeCandidates(endpoint.type, v, allowedEndpoints).some(
          c => endpointTypeKey(c.ref) === typeKey,
        ),
      );
      nextKey.current += 1;
      const key = `new:${nextKey.current}`;
      setDrafts(ds => [
        ...ds,
        {
          key,
          workloadEndpoint,
          typeKind: (entry.ref.kind || 'EndpointType') as EndpointTypeKind,
          typeName: entry.ref.name,
          visibility,
          parameters: {},
          deleted: false,
        },
      ]);
      return key;
    },
    [drafts, allowedEndpoints],
  );

  const update = useCallback((key: string, patch: EndpointDraftPatch) => {
    setDrafts(ds => ds.map(d => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  const remove = useCallback(
    (key: string) => {
      setDrafts(ds =>
        ds.flatMap(d => {
          if (d.key !== key) return [d];
          return d.original ? [{ ...d, deleted: true }] : [];
        }),
      );
      setEditing(key, false);
    },
    [setEditing],
  );

  const undoRemove = useCallback((key: string) => {
    setDrafts(ds =>
      ds.map(d => (d.key === key ? { ...d, deleted: false } : d)),
    );
  }, []);

  const renameWorkloadEndpoint = useCallback((from: string, to: string) => {
    if (from === to) return;
    setDrafts(ds =>
      ds.map(d =>
        d.workloadEndpoint === from ? { ...d, workloadEndpoint: to } : d,
      ),
    );
  }, []);

  const apply = useCallback(
    async (
      workloadEndpoints: Record<string, ExposableEndpoint>,
      autoDeploy: boolean,
    ) => {
      for (const change of planEndpointChanges(drafts, workloadEndpoints)) {
        const { draft } = change;
        try {
          if (change.op === 'delete') {
            await client.deleteComponentEndpoint(
              entity,
              change.draft.original.name,
            );
            setDrafts(ds => ds.filter(d => d.key !== draft.key));
          } else if (change.op === 'update') {
            const saved = await client.updateComponentEndpoint(
              entity,
              change.draft.original.name,
              {
                visibility: change.visibility,
                parameters: draft.parameters,
                workloadEndpoint: draft.workloadEndpoint,
              },
            );
            setDrafts(ds =>
              ds.map(d => (d.key === draft.key ? draftFromSummary(saved) : d)),
            );
          } else {
            const { name } = await client.createComponentEndpoint(entity, {
              workloadEndpoint: draft.workloadEndpoint,
              typeKind: draft.typeKind,
              typeName: draft.typeName,
              visibility: change.visibility,
              parameters: draft.parameters,
              autoDeploy,
            });
            setDrafts(ds =>
              ds.map(d =>
                d.key === draft.key
                  ? draftFromSummary({
                      name,
                      workloadEndpoint: draft.workloadEndpoint,
                      typeKind: draft.typeKind,
                      typeName: draft.typeName,
                      visibility: change.visibility,
                      parameters: draft.parameters,
                      autoDeploy,
                    })
                  : d,
              ),
            );
          }
        } catch (e) {
          throw new Error(
            `Endpoint ${draftLabel(draft)} could not be ${
              { create: 'created', update: 'updated', delete: 'deleted' }[
                change.op
              ]
            }: ${getErrorMessage(e)}`,
          );
        }
      }
    },
    [client, entity, drafts],
  );

  return useMemo(
    () => ({
      loading,
      loadError,
      allowedEndpoints,
      drafts,
      enabled: allowedEndpoints.length > 0 || drafts.length > 0,
      isEditing: editingKeys.length > 0,
      setEditing,
      add,
      update,
      remove,
      undoRemove,
      renameWorkloadEndpoint,
      apply,
    }),
    [
      loading,
      loadError,
      allowedEndpoints,
      drafts,
      editingKeys,
      setEditing,
      add,
      update,
      remove,
      undoRemove,
      renameWorkloadEndpoint,
      apply,
    ],
  );
}

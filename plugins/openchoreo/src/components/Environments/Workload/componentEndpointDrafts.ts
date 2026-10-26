import {
  exposableVisibilities,
  type ComponentEndpointSummary,
  type EndpointTypeKind,
  type ExposableEndpoint,
} from '@openchoreo/backstage-plugin-common';
import {
  deepCompareObjects,
  type Change,
} from '@openchoreo/backstage-plugin-react';

/**
 * A component's own Endpoint as staged on the configure page. Edits stay
 * local until the page is saved; `original` is what the Endpoint is on the
 * server, absent for one added on the page.
 */
export interface EndpointDraft {
  /** The Endpoint's name, or a local key for one not created yet. */
  key: string;
  original?: ComponentEndpointSummary;
  workloadEndpoint: string;
  typeKind: EndpointTypeKind;
  typeName: string;
  visibility: string[];
  parameters: Record<string, unknown>;
  deleted: boolean;
}

/**
 * Why a staged Endpoint is deleted on save: the developer deleted it, or the
 * workload endpoint it exposes is gone or no longer has a visibility it
 * serves.
 */
export type EndpointDeleteReason =
  | 'deleted'
  | 'workloadEndpointRemoved'
  | 'notExposed';

/** How a staged Endpoint relates to the workload as it is now edited. */
export interface EndpointDraftStatus {
  /** The visibilities that will be saved. */
  visibility: string[];
  /** Staged visibilities the workload endpoint no longer has. */
  dropped: string[];
  deleteReason?: EndpointDeleteReason;
}

export type EndpointChange =
  | { op: 'create'; draft: EndpointDraft; visibility: string[] }
  | {
      op: 'update';
      draft: EndpointDraft & { original: ComponentEndpointSummary };
      visibility: string[];
    }
  | {
      op: 'delete';
      draft: EndpointDraft & { original: ComponentEndpointSummary };
      reason: EndpointDeleteReason;
    };

export function draftFromSummary(
  summary: ComponentEndpointSummary,
): EndpointDraft {
  return {
    key: summary.name,
    original: summary,
    workloadEndpoint: summary.workloadEndpoint,
    typeKind: summary.typeKind,
    typeName: summary.typeName,
    visibility: [...summary.visibility],
    parameters: summary.parameters,
    deleted: false,
  };
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(v => b.includes(v));
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

/**
 * Compares a staged Endpoint against the workload endpoints being edited: an
 * Endpoint keeps only the visibilities its workload endpoint still has, and
 * is deleted when none is left or the workload endpoint is gone.
 */
export function draftStatus(
  draft: EndpointDraft,
  workloadEndpoints: Record<string, ExposableEndpoint>,
): EndpointDraftStatus {
  const endpoint = workloadEndpoints[draft.workloadEndpoint];
  if (draft.deleted) {
    return { visibility: [], dropped: [], deleteReason: 'deleted' };
  }
  if (!endpoint) {
    return {
      visibility: [],
      dropped: [],
      deleteReason: 'workloadEndpointRemoved',
    };
  }
  const exposable = exposableVisibilities(endpoint);
  const visibility = draft.visibility.filter(v => exposable.includes(v));
  const dropped = draft.visibility.filter(v => !exposable.includes(v));
  if (visibility.length === 0) {
    return { visibility, dropped, deleteReason: 'notExposed' };
  }
  return { visibility, dropped };
}

/**
 * The calls that save the staged Endpoints: deletes first, so a recreated
 * Endpoint never clashes with the one it replaces, then updates and creates.
 * An Endpoint added and then dropped again on the page needs no call.
 */
export function planEndpointChanges(
  drafts: EndpointDraft[],
  workloadEndpoints: Record<string, ExposableEndpoint>,
): EndpointChange[] {
  const deletes: EndpointChange[] = [];
  const updates: EndpointChange[] = [];
  const creates: EndpointChange[] = [];
  for (const draft of drafts) {
    const status = draftStatus(draft, workloadEndpoints);
    const { original } = draft;
    if (!original) {
      if (!status.deleteReason) {
        creates.push({ op: 'create', draft, visibility: status.visibility });
      }
      continue;
    }
    const tracked = { ...draft, original };
    if (status.deleteReason) {
      deletes.push({
        op: 'delete',
        draft: tracked,
        reason: status.deleteReason,
      });
    } else if (
      !sameSet(status.visibility, original.visibility) ||
      !sameValue(draft.parameters, original.parameters) ||
      draft.workloadEndpoint !== original.workloadEndpoint
    ) {
      updates.push({
        op: 'update',
        draft: tracked,
        visibility: status.visibility,
      });
    }
  }
  return [...deletes, ...updates, ...creates];
}

/** Display name of a staged Endpoint in change lists. */
export function draftLabel(draft: EndpointDraft): string {
  return draft.original
    ? draft.original.name
    : `new ${draft.typeName} Endpoint for ${draft.workloadEndpoint}`;
}

const DELETE_REASONS: Record<EndpointDeleteReason, string> = {
  deleted: 'Deleted',
  workloadEndpointRemoved: 'Deleted (workload endpoint removed)',
  notExposed: 'Deleted (no internal or external visibility left)',
};

/** The staged Endpoint changes, as the save confirmation lists them. */
export function endpointChangeList(changes: EndpointChange[]): Change[] {
  const list: Change[] = [];
  for (const change of changes) {
    const label = draftLabel(change.draft);
    switch (change.op) {
      case 'create':
        list.push({
          path: label,
          type: 'new',
          newValue: `${change.draft.typeName} · ${change.visibility.join(
            ', ',
          )}`,
        });
        break;
      case 'delete':
        list.push({
          path: label,
          type: 'removed',
          oldValue: DELETE_REASONS[change.reason],
        });
        break;
      case 'update': {
        const { draft, visibility } = change;
        const { original } = draft;
        if (draft.workloadEndpoint !== original.workloadEndpoint) {
          list.push({
            path: `${label}.workloadEndpoint`,
            type: 'modified',
            oldValue: original.workloadEndpoint,
            newValue: draft.workloadEndpoint,
          });
        }
        if (!sameSet(visibility, original.visibility)) {
          list.push({
            path: `${label}.visibility`,
            type: 'modified',
            oldValue: original.visibility.join(', '),
            newValue: visibility.join(', '),
          });
        }
        for (const diff of deepCompareObjects(
          original.parameters ?? {},
          draft.parameters ?? {},
        )) {
          list.push({ ...diff, path: `${label}.parameters.${diff.path}` });
        }
        break;
      }
      default:
        break;
    }
  }
  return list;
}

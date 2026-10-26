import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { Alert } from '@material-ui/lab';
import AddIcon from '@material-ui/icons/Add';
import DeleteOutlineIcon from '@material-ui/icons/DeleteOutline';
import EditOutlinedIcon from '@material-ui/icons/EditOutlined';
import UndoIcon from '@material-ui/icons/Undo';
import { JSONSchema7 } from 'json-schema';
import { RjsfForm } from '@openchoreo/backstage-design-system';
import {
  endpointTypeCandidates,
  endpointTypeKey,
  exposableVisibilities,
  sanitizeLabel,
  type AllowedEndpointTypeEntry,
  type EndpointTypeKind,
  type ExposableEndpoint,
} from '@openchoreo/backstage-plugin-common';
import type { SchemaState } from '../../../../scaffolder/WorkloadDetailsField/EndpointExposure';
import { generateUiSchemaWithTitles } from '../../../../scaffolder/utils/rjsfUtils';
import {
  draftStatus,
  type EndpointDraft,
  type EndpointDraftStatus,
} from '../componentEndpointDrafts';
import {
  uncoveredVisibilities,
  type ComponentEndpointsState,
} from '../hooks/useComponentEndpoints';

const useStyles = makeStyles(theme => ({
  heading: {
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(1),
  },
  card: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(1, 1.5),
    backgroundColor: theme.palette.background.paper,
    '& + &': {
      marginTop: theme.spacing(1),
    },
  },
  cardDeleted: {
    opacity: 0.6,
    '& $cardName': {
      textDecoration: 'line-through',
    },
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(0.75),
  },
  cardName: {
    fontWeight: 600,
    fontSize: '0.875rem',
  },
  typeName: {
    fontSize: '0.8125rem',
    color: theme.palette.text.secondary,
  },
  spacer: {
    flex: 1,
  },
  chip: {
    height: 20,
    fontSize: '0.7rem',
  },
  parameters: {
    marginTop: theme.spacing(0.5),
    fontSize: '0.8125rem',
    color: theme.palette.text.secondary,
    wordBreak: 'break-word',
  },
  parameterKey: {
    color: theme.palette.text.primary,
  },
  notice: {
    marginTop: theme.spacing(1),
  },
  editBody: {
    marginTop: theme.spacing(1),
  },
  select: {
    minWidth: 260,
    marginBottom: theme.spacing(1),
  },
  editActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
  uncovered: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
    fontSize: '0.8125rem',
    color: theme.palette.text.secondary,
  },
}));

function typeKeyOf(draft: { typeKind: EndpointTypeKind; typeName: string }) {
  return endpointTypeKey({ kind: draft.typeKind, name: draft.typeName });
}

function hasProperties(schema: JSONSchema7): boolean {
  return Object.keys(schema.properties ?? {}).length > 0;
}

function formatValue(value: unknown): string {
  return typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : String(value);
}

const DELETE_NOTICES = {
  deleted: undefined,
  workloadEndpointRemoved:
    'Its workload endpoint was removed, so this Endpoint is deleted on save.',
  notExposed:
    'Its workload endpoint no longer has internal or external visibility, so this Endpoint is deleted on save.',
};

/**
 * The visibilities an Endpoint of this type may expose for this workload
 * endpoint: those the ComponentType allows the type for, plus any the
 * Endpoint already has, so a type no longer allowed can still be edited.
 */
function visibilityOptions(
  draft: EndpointDraft,
  endpoint: ExposableEndpoint | undefined,
  allowedEndpoints: AllowedEndpointTypeEntry[],
): string[] {
  const key = typeKeyOf(draft);
  const allowed = endpoint
    ? exposableVisibilities(endpoint).filter(v =>
        endpointTypeCandidates(endpoint.type, v, allowedEndpoints).some(
          c => endpointTypeKey(c.ref) === key,
        ),
      )
    : [];
  return [...new Set([...allowed, ...draft.visibility])];
}

interface EndpointCardProps {
  draft: EndpointDraft;
  status: EndpointDraftStatus;
  endpoint?: ExposableEndpoint;
  state: ComponentEndpointsState;
  schema?: SchemaState;
  /** Open in edit mode, as for an Endpoint just added. */
  startEditing?: boolean;
  onStartedEditing?: () => void;
  disabled: boolean;
}

/** One Endpoint of the workload endpoint: its type, visibility and parameters. */
const EndpointCard = ({
  draft,
  status,
  endpoint,
  state,
  schema,
  startEditing,
  onStartedEditing,
  disabled,
}: EndpointCardProps) => {
  const classes = useStyles();
  const [buffer, setBuffer] = useState<EndpointDraft | null>(null);
  // Set while editing an Endpoint just added, which Cancel discards.
  const [fresh, setFresh] = useState(false);
  const { setEditing } = state;

  useEffect(() => {
    if (startEditing) {
      setBuffer(draft);
      setFresh(true);
      setEditing(draft.key, true);
      onStartedEditing?.();
    }
  }, [startEditing, draft, setEditing, onStartedEditing]);

  // Leaving the page section mid-edit must not keep Save disabled.
  useEffect(() => () => setEditing(draft.key, false), [draft.key, setEditing]);

  const isNew = !draft.original;
  const editing = buffer !== null;

  const startEdit = () => {
    setBuffer(draft);
    setEditing(draft.key, true);
  };
  const finishEdit = (save: boolean) => {
    if (save && buffer) {
      state.update(draft.key, {
        typeKind: buffer.typeKind,
        typeName: buffer.typeName,
        visibility: buffer.visibility,
        parameters: buffer.parameters,
      });
    } else if (!save && fresh) {
      state.remove(draft.key);
    }
    setFresh(false);
    setBuffer(null);
    setEditing(draft.key, false);
  };

  const readyChip = (() => {
    const ready = draft.original?.ready;
    if (isNew) {
      return (
        <Chip
          size="small"
          color="primary"
          label="Created on save"
          className={classes.chip}
        />
      );
    }
    if (!ready) return null;
    return (
      <Tooltip title={ready.message ?? ''}>
        <Chip
          size="small"
          variant="outlined"
          label={
            ready.status === 'True' ? 'Ready' : ready.reason ?? 'Not ready'
          }
          className={classes.chip}
          style={
            ready.status === 'True' ? undefined : { borderStyle: 'dashed' }
          }
        />
      </Tooltip>
    );
  })();

  const header = (
    <Box className={classes.cardHeader}>
      <Typography className={classes.cardName}>
        {draft.original?.name ?? 'New Endpoint'}
      </Typography>
      <Typography className={classes.typeName}>
        {draft.typeKind}: {draft.typeName}
      </Typography>
      {(editing ? buffer!.visibility : status.visibility).map(v => (
        <Chip
          key={v}
          size="small"
          label={sanitizeLabel(v)}
          className={classes.chip}
        />
      ))}
      {readyChip}
      <Box className={classes.spacer} />
      {draft.deleted ? (
        <Tooltip title="Undo delete">
          <span>
            <IconButton
              size="small"
              aria-label="Undo delete"
              onClick={() => state.undoRemove(draft.key)}
              disabled={disabled}
            >
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) : (
        !editing &&
        !status.deleteReason && (
          <>
            <Tooltip title="Edit Endpoint">
              <span>
                <IconButton
                  size="small"
                  aria-label="Edit Endpoint"
                  onClick={startEdit}
                  disabled={disabled || state.isEditing}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Delete Endpoint">
              <span>
                <IconButton
                  size="small"
                  aria-label="Delete Endpoint"
                  onClick={() => state.remove(draft.key)}
                  disabled={disabled || state.isEditing}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )
      )}
    </Box>
  );

  if (editing) {
    const current = buffer!;
    const options = visibilityOptions(
      current,
      endpoint,
      state.allowedEndpoints,
    );
    // A new Endpoint can still change type; an existing one's is immutable.
    const typeChoices =
      isNew && endpoint
        ? [
            ...new Map(
              uncoveredVisibilities(
                draft.workloadEndpoint,
                endpoint,
                state.drafts.filter(d => d.key !== draft.key),
              )
                .flatMap(v =>
                  endpointTypeCandidates(
                    endpoint.type,
                    v,
                    state.allowedEndpoints,
                  ),
                )
                .map(c => [endpointTypeKey(c.ref), c]),
            ).values(),
          ]
        : [];
    const setType = (key: string) => {
      const entry = typeChoices.find(c => endpointTypeKey(c.ref) === key);
      if (!entry) return;
      const next = {
        ...current,
        typeKind: (entry.ref.kind || 'EndpointType') as EndpointTypeKind,
        typeName: entry.ref.name,
        parameters: {},
      };
      setBuffer({
        ...next,
        visibility: visibilityOptions(
          { ...next, visibility: [] },
          endpoint,
          state.allowedEndpoints,
        ).filter(v =>
          uncoveredVisibilities(
            draft.workloadEndpoint,
            endpoint!,
            state.drafts.filter(d => d.key !== draft.key),
          ).includes(v),
        ),
      });
    };
    const toggleVisibility = (v: string, on: boolean) =>
      setBuffer({
        ...current,
        visibility: on
          ? [...current.visibility, v]
          : current.visibility.filter(x => x !== v),
      });

    let parameters;
    if (schema === undefined || schema === 'loading') {
      parameters = <CircularProgress size={20} />;
    } else if (schema === 'error') {
      parameters = (
        <Alert severity="warning">
          Could not load the parameters of {current.typeName}.
        </Alert>
      );
    } else if (hasProperties(schema)) {
      parameters = (
        <RjsfForm
          schema={schema}
          uiSchema={generateUiSchemaWithTitles(schema)}
          formData={current.parameters}
          onChange={(e: any) =>
            setBuffer(b => (b ? { ...b, parameters: e.formData ?? {} } : b))
          }
          tagName="div"
        />
      );
    } else {
      parameters = (
        <Typography variant="body2" color="textSecondary">
          {current.typeName} takes no parameters.
        </Typography>
      );
    }

    return (
      <Box className={classes.card}>
        {header}
        <Box className={classes.editBody}>
          {typeChoices.length > 1 && (
            <TextField
              select
              variant="outlined"
              size="small"
              className={classes.select}
              label="Endpoint type"
              value={typeKeyOf(current)}
              onChange={e => setType(e.target.value)}
            >
              {typeChoices.map(c => (
                <MenuItem
                  key={endpointTypeKey(c.ref)}
                  value={endpointTypeKey(c.ref)}
                >
                  {c.ref.name}
                  {c.name ? ` (${c.name})` : ''}
                  {c.default ? ' — default' : ''}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Box>
            {options.map(v => (
              <FormControlLabel
                key={v}
                control={
                  <Checkbox
                    size="small"
                    color="primary"
                    checked={current.visibility.includes(v)}
                    onChange={e => toggleVisibility(v, e.target.checked)}
                  />
                }
                label={sanitizeLabel(v)}
              />
            ))}
          </Box>
          {parameters}
          <Box className={classes.editActions}>
            <Button size="small" onClick={() => finishEdit(false)}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={() => finishEdit(true)}
              disabled={current.visibility.length === 0}
            >
              Done
            </Button>
          </Box>
        </Box>
      </Box>
    );
  }

  const parameterEntries = Object.entries(draft.parameters ?? {});
  return (
    <Box
      className={`${classes.card} ${
        status.deleteReason ? classes.cardDeleted : ''
      }`}
    >
      {header}
      <Typography component="div" className={classes.parameters}>
        {parameterEntries.length === 0
          ? 'Default parameters'
          : parameterEntries.map(([key, value], i) => (
              <span key={key}>
                {i > 0 && ' · '}
                <span className={classes.parameterKey}>
                  {sanitizeLabel(key)}
                </span>
                : {formatValue(value)}
              </span>
            ))}
      </Typography>
      {status.deleteReason && DELETE_NOTICES[status.deleteReason] && (
        <Alert severity="warning" className={classes.notice}>
          {DELETE_NOTICES[status.deleteReason]}
        </Alert>
      )}
      {!status.deleteReason && status.dropped.length > 0 && (
        <Alert severity="info" className={classes.notice}>
          The workload endpoint no longer has{' '}
          {status.dropped.map(sanitizeLabel).join(', ')} visibility, so it is
          removed from this Endpoint on save.
        </Alert>
      )}
      {draft.deleted && (
        <Alert severity="warning" className={classes.notice}>
          Deleted on save. Its routes are removed from every environment.
        </Alert>
      )}
    </Box>
  );
};

export interface ComponentEndpointExposureProps {
  /** The workload endpoint's name as the row is saved under. */
  workloadEndpoint: string;
  /** The workload endpoint's values, as currently edited. */
  endpoint: ExposableEndpoint;
  state: ComponentEndpointsState;
  schemas: Record<string, SchemaState>;
  disabled: boolean;
}

/**
 * How one workload endpoint is exposed through the component's Endpoints,
 * shown inside its row: each Endpoint with its type, visibility and
 * parameters, editable and deletable, and an action to add one for the
 * visibilities no Endpoint covers.
 */
export const ComponentEndpointExposure = ({
  workloadEndpoint,
  endpoint,
  state,
  schemas,
  disabled,
}: ComponentEndpointExposureProps) => {
  const classes = useStyles();
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const drafts = state.drafts.filter(
    d => d.workloadEndpoint === workloadEndpoint,
  );
  const workloadEndpoints = { [workloadEndpoint]: endpoint };
  const uncovered = uncoveredVisibilities(
    workloadEndpoint,
    endpoint,
    state.drafts,
  );
  const canAdd = uncovered.some(
    v =>
      endpointTypeCandidates(endpoint.type, v, state.allowedEndpoints).length,
  );

  if (drafts.length === 0 && exposableVisibilities(endpoint).length === 0) {
    return null;
  }

  return (
    <Box>
      <Typography className={classes.heading}>Endpoints</Typography>
      {drafts.map(draft => (
        <EndpointCard
          key={draft.key}
          draft={draft}
          status={draftStatus(draft, workloadEndpoints)}
          endpoint={endpoint}
          state={state}
          schema={schemas[typeKeyOf(draft)]}
          startEditing={justAdded === draft.key}
          onStartedEditing={() => setJustAdded(null)}
          disabled={disabled}
        />
      ))}
      {uncovered.length > 0 && (
        <Box className={classes.uncovered}>
          <span>
            {uncovered.map(sanitizeLabel).join(', ')}{' '}
            {uncovered.length === 1 ? 'is' : 'are'} served by the component
            type's own routes.
          </span>
          {canAdd && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              disabled={disabled || state.isEditing}
              onClick={() => {
                const key = state.add(workloadEndpoint, endpoint);
                if (key) setJustAdded(key);
              }}
            >
              Add Endpoint
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
};

/**
 * Endpoints whose workload endpoint is no longer in the workload, listed
 * under the workload endpoints since they have no row to sit in. They are
 * deleted on save.
 */
export const DetachedComponentEndpoints = ({
  workloadEndpoints,
  state,
  disabled,
}: {
  workloadEndpoints: Record<string, ExposableEndpoint>;
  state: ComponentEndpointsState;
  disabled: boolean;
}) => {
  const classes = useStyles();
  const detached = state.drafts.filter(
    d => d.original && !workloadEndpoints[d.workloadEndpoint],
  );
  if (detached.length === 0) return null;
  return (
    <Box mt={3}>
      <Typography className={classes.heading}>
        Endpoints of removed workload endpoints
      </Typography>
      {detached.map(draft => (
        <EndpointCard
          key={draft.key}
          draft={draft}
          status={draftStatus(draft, workloadEndpoints)}
          state={state}
          disabled={disabled}
        />
      ))}
    </Box>
  );
};

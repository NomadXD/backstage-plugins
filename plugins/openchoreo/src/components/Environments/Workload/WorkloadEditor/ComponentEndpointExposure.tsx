import { Box, Chip, Tooltip, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import {
  NO_ENDPOINT,
  exposableVisibilities,
  resolveEndpointType,
  type ComponentEndpointSummary,
  type ExposableEndpoint,
} from '@openchoreo/backstage-plugin-common';
import {
  EndpointExposure,
  type SchemaState,
} from '../../../../scaffolder/WorkloadDetailsField/EndpointExposure';
import {
  currentEndpointName,
  primaryOriginals,
} from '../componentEndpointDrafts';
import type { ComponentEndpointsState } from '../hooks/useComponentEndpoints';

const useStyles = makeStyles(theme => ({
  chip: {
    height: 22,
    fontSize: '0.75rem',
  },
  heading: {
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(1),
  },
  item: {
    fontSize: '0.8125rem',
    color: theme.palette.text.secondary,
  },
}));

/** The Endpoint a row is exposed through, with its Ready state. */
const EndpointStatus = ({
  original,
}: {
  original: ComponentEndpointSummary;
}) => {
  const classes = useStyles();
  const ready = original.ready;
  let label = original.name;
  if (ready) {
    label +=
      ready.status === 'True'
        ? ' · Ready'
        : ` · ${ready.reason ?? 'Not ready'}`;
  }
  return (
    <Tooltip title={ready?.message ?? `Endpoint ${original.name}`}>
      <Chip
        size="small"
        variant="outlined"
        label={label}
        className={classes.chip}
      />
    </Tooltip>
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
 * How one workload endpoint is exposed, inside its row on the configure
 * page: the same "Exposed via" field as the creation form, with the Endpoint
 * the row is already exposed through. That Endpoint's type is immutable, so
 * the field is fixed for it. Choosing a type for a row that has none moves
 * its visibility from the workload to a new Endpoint on save.
 */
export const ComponentEndpointExposure = ({
  workloadEndpoint,
  endpoint,
  state,
  schemas,
  disabled,
}: ComponentEndpointExposureProps) => {
  const original = primaryOriginals(state.originals, state.renames).get(
    workloadEndpoint,
  );
  const typeKey = resolveEndpointType(
    endpoint,
    state.allowedEndpoints,
    state.choices[workloadEndpoint],
  );
  const dropped =
    original &&
    (exposableVisibilities(endpoint).length === 0 || typeKey === NO_ENDPOINT);

  return (
    <EndpointExposure
      endpoint={endpoint}
      allowedEndpoints={state.allowedEndpoints}
      choice={state.choices[workloadEndpoint]}
      schemas={schemas}
      onChange={choice => state.setChoice(workloadEndpoint, choice)}
      status={original && <EndpointStatus original={original} />}
      typeLocked={!!original}
      notice={
        dropped ? (
          <Typography variant="body2" color="textSecondary">
            Endpoint {original.name} is deleted on save.
          </Typography>
        ) : undefined
      }
      disabled={disabled}
    />
  );
};

/**
 * The component's Endpoints that no row shows: those whose workload endpoint
 * was removed (deleted on save) and any further Endpoints of one workload
 * endpoint, which this page leaves as they are.
 */
export const DetachedComponentEndpoints = ({
  workloadEndpoints,
  state,
}: {
  workloadEndpoints: Record<string, ExposableEndpoint>;
  state: ComponentEndpointsState;
}) => {
  const classes = useStyles();
  const primary = primaryOriginals(state.originals, state.renames);
  const detached = state.originals.filter(original => {
    const name = currentEndpointName(original, state.renames);
    return !workloadEndpoints[name] || primary.get(name) !== original;
  });
  if (detached.length === 0) return null;
  return (
    <Box mt={3}>
      <Typography className={classes.heading}>Other Endpoints</Typography>
      {detached.map(original => {
        const name = currentEndpointName(original, state.renames);
        return (
          <Typography key={original.name} className={classes.item}>
            {original.name} ({original.typeName},{' '}
            {original.visibility.join(', ')}) —{' '}
            {workloadEndpoints[name]
              ? `also exposes ${name}; this page leaves it as it is`
              : `its workload endpoint ${name} was removed, so it is deleted on save`}
          </Typography>
        );
      })}
    </Box>
  );
};

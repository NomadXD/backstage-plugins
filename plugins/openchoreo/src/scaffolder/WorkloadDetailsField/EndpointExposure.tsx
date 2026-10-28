import { useEffect, useState, type ReactNode } from 'react';
import {
  Box,
  CircularProgress,
  MenuItem,
  TextField,
  Typography,
  makeStyles,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { useApi } from '@backstage/core-plugin-api';
import { JSONSchema7 } from 'json-schema';
import { RjsfForm } from '@openchoreo/backstage-design-system';
import {
  NO_ENDPOINT,
  endpointProtocol,
  endpointTypeCandidates,
  endpointTypeKey,
  exposableVisibilities,
  parseEndpointTypeKey,
  resolveEndpointType,
  type AllowedEndpointTypeEntry,
  type EndpointExposureChoice,
  type EndpointExposures,
  type ExposableEndpoint,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { generateUiSchemaWithTitles } from '../utils/rjsfUtils';

const useStyles = makeStyles(theme => ({
  row: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
  },
  select: {
    minWidth: 260,
  },
  placeholder: {
    color: theme.palette.text.secondary,
  },
  note: {
    fontSize: '0.8125rem',
    color: theme.palette.text.secondary,
  },
  parameters: {
    marginTop: theme.spacing(1.5),
  },
  parametersHeading: {
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: theme.palette.text.secondary,
  },
}));

export type SchemaState = JSONSchema7 | 'loading' | 'error';

function entryLabel(entry: AllowedEndpointTypeEntry): string {
  return entry.name ? `${entry.ref.name} (${entry.name})` : entry.ref.name;
}

function hasProperties(schema: JSONSchema7): boolean {
  return Object.keys(schema.properties ?? {}).length > 0;
}

/**
 * The exposure choice the form submits for every workload endpoint that can
 * be exposed through an Endpoint: the resolved EndpointType (or none) and
 * its parameters. Choices for endpoints that no longer exist are dropped.
 */
export function formExposures(
  endpoints: Record<string, ExposableEndpoint>,
  allowedEndpoints: AllowedEndpointTypeEntry[],
  exposures: EndpointExposures,
): EndpointExposures {
  const out: EndpointExposures = {};
  for (const [name, endpoint] of Object.entries(endpoints)) {
    if (
      exposableVisibilities(endpoint).length === 0 ||
      endpointTypeCandidates(endpointProtocol(endpoint), allowedEndpoints)
        .length === 0
    ) {
      continue;
    }
    const type = resolveEndpointType(
      endpoint,
      allowedEndpoints,
      exposures[name],
    );
    out[name] = {
      type,
      ...(type !== NO_ENDPOINT &&
        exposures[name]?.type === type &&
        exposures[name]?.parameters && {
          parameters: exposures[name].parameters,
        }),
    };
  }
  return out;
}

/** The EndpointTypes the form currently uses across all endpoints. */
export function chosenEndpointTypeKeys(
  endpoints: Record<string, ExposableEndpoint>,
  allowedEndpoints: AllowedEndpointTypeEntry[],
  exposures: EndpointExposures,
): string[] {
  const keys = new Set<string>();
  for (const choice of Object.values(
    formExposures(endpoints, allowedEndpoints, exposures),
  )) {
    if (choice.type !== NO_ENDPOINT) keys.add(choice.type);
  }
  return [...keys].sort();
}

/**
 * Loads the parameters schema of each chosen EndpointType once and keeps it
 * for every endpoint that uses that type.
 */
export function useEndpointTypeSchemas(
  keys: string[],
  namespaceName: string,
): Record<string, SchemaState> {
  const client = useApi(openChoreoClientApiRef);
  const [schemas, setSchemas] = useState<Record<string, SchemaState>>({});
  const missingKey = keys.filter(key => !(key in schemas)).join(',');

  useEffect(() => {
    if (!missingKey) return;
    const missing = missingKey.split(',');
    setSchemas(prev => ({
      ...prev,
      ...Object.fromEntries(missing.map(k => [k, 'loading' as const])),
    }));
    for (const key of missing) {
      const { kind, name } = parseEndpointTypeKey(key);
      client
        .fetchEndpointTypeParametersSchema(kind, name, namespaceName)
        .then(result =>
          setSchemas(prev => ({
            ...prev,
            [key]: (result.data as JSONSchema7) ?? { type: 'object' },
          })),
        )
        .catch(() => setSchemas(prev => ({ ...prev, [key]: 'error' })));
    }
  }, [missingKey, client, namespaceName]);

  return schemas;
}

interface EndpointExposureProps {
  /** The workload endpoint as currently edited. */
  endpoint: ExposableEndpoint;
  allowedEndpoints: AllowedEndpointTypeEntry[];
  choice?: EndpointExposureChoice;
  schemas: Record<string, SchemaState>;
  onChange: (choice: EndpointExposureChoice) => void;
  /** Shown next to the field, e.g. the existing Endpoint and its state. */
  status?: ReactNode;
  /**
   * The row is already exposed through an Endpoint, whose type cannot
   * change: the choice is shown but fixed.
   */
  typeLocked?: boolean;
  /** Shown instead of the default note when the choice changes nothing. */
  notice?: ReactNode;
  disabled?: boolean;
}

/**
 * How one workload endpoint is exposed, shown inside its row once it has a
 * visibility beyond project: an "Exposed via" choice of the EndpointTypes
 * allowed for its protocol, or none, and the chosen type's parameters. With
 * none (or no type allowed for the protocol) the visibility stays on the
 * workload, in the deprecated field the ComponentType's templates read.
 */
export const EndpointExposure = ({
  endpoint,
  allowedEndpoints,
  choice,
  schemas,
  onChange,
  status,
  typeLocked,
  notice,
  disabled,
}: EndpointExposureProps) => {
  const classes = useStyles();
  const visibilities = exposableVisibilities(endpoint);
  const candidates = endpointTypeCandidates(
    endpointProtocol(endpoint),
    allowedEndpoints,
  );
  if (visibilities.length === 0) {
    return notice ? <Box className={classes.note}>{notice}</Box> : null;
  }

  const deprecatedNote = (
    <Typography className={classes.note}>
      {visibilities.join(', ')} visibility is stored on the workload
      (deprecated) and served by the component type's own routes, if it defines
      any.
    </Typography>
  );
  if (candidates.length === 0) {
    return notice ? (
      <Box className={classes.note}>{notice}</Box>
    ) : (
      deprecatedNote
    );
  }

  const type = resolveEndpointType(endpoint, allowedEndpoints, choice);
  const labelOf = (key: string) => {
    const entry = candidates.find(c => endpointTypeKey(c.ref) === key);
    return entry ? entryLabel(entry) : parseEndpointTypeKey(key).name;
  };
  const parameters =
    choice?.type === type ? choice?.parameters ?? {} : ({} as const);

  let body: ReactNode = notice ?? deprecatedNote;
  if (type !== NO_ENDPOINT) {
    const schema = schemas[type];
    const { name: typeName } = parseEndpointTypeKey(type);
    if (schema === undefined || schema === 'loading') {
      body = <CircularProgress size={20} />;
    } else if (schema === 'error') {
      body = (
        <Alert severity="warning">
          Could not load the parameters of {typeName}; its defaults will be
          used.
        </Alert>
      );
    } else if (hasProperties(schema)) {
      body = (
        <>
          <Typography className={classes.parametersHeading}>
            Parameters
          </Typography>
          <RjsfForm
            schema={schema}
            uiSchema={generateUiSchemaWithTitles(schema)}
            formData={parameters}
            onChange={(e: any) =>
              onChange({ type, parameters: e.formData ?? {} })
            }
            disabled={disabled}
            tagName="div"
          />
        </>
      );
    } else {
      body = notice ?? null;
    }
  }

  return (
    <Box>
      <Box className={classes.row}>
        <TextField
          select
          variant="outlined"
          size="small"
          className={classes.select}
          label="Exposed via"
          // An existing component's endpoint not yet moved to an Endpoint
          // has no type: the field stays empty until one is chosen.
          value={type === NO_ENDPOINT ? '' : type}
          disabled={disabled || typeLocked}
          InputLabelProps={{ shrink: true }}
          SelectProps={{
            displayEmpty: true,
            renderValue: value =>
              value ? (
                labelOf(value as string)
              ) : (
                <span className={classes.placeholder}>
                  Choose an endpoint type
                </span>
              ),
          }}
          helperText={
            typeLocked
              ? "An Endpoint's type is fixed once created. Clear the visibility beyond project to delete it."
              : undefined
          }
          onChange={e => onChange({ type: e.target.value })}
        >
          {candidates.map(entry => (
            <MenuItem
              key={endpointTypeKey(entry.ref)}
              value={endpointTypeKey(entry.ref)}
            >
              {entryLabel(entry)}
            </MenuItem>
          ))}
        </TextField>
        {status}
      </Box>
      {body && <Box className={classes.parameters}>{body}</Box>}
    </Box>
  );
};

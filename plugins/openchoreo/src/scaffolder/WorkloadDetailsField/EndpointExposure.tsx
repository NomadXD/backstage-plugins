import { useEffect, useState } from 'react';
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
  endpointTypeCandidates,
  endpointTypeKey,
  exposableVisibilities,
  resolveEndpointTypes,
  type AllowedEndpointTypeEntry,
  type EndpointExposureChoice,
  type EndpointExposures,
  type ExposableEndpoint,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { generateUiSchemaWithTitles } from '../utils/rjsfUtils';

const useStyles = makeStyles(theme => ({
  choice: {
    marginBottom: theme.spacing(1.5),
  },
  select: {
    minWidth: 260,
  },
  typeBlock: {
    '& + &': {
      marginTop: theme.spacing(2),
    },
  },
  typeHeading: {
    fontWeight: 600,
    fontSize: '0.875rem',
    marginBottom: theme.spacing(1),
  },
  typeVisibilities: {
    fontWeight: 400,
    color: theme.palette.text.secondary,
  },
  parametersHeading: {
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: theme.palette.text.secondary,
  },
}));

export type SchemaState = JSONSchema7 | 'loading' | 'error';

function typeLabel(entry: AllowedEndpointTypeEntry): string {
  const alias = entry.name ? ` (${entry.name})` : '';
  return `${entry.ref.name}${alias}${entry.default ? ' — default' : ''}`;
}

function splitKey(key: string) {
  const slash = key.indexOf('/');
  return {
    kind: key.slice(0, slash) as 'EndpointType' | 'ClusterEndpointType',
    name: key.slice(slash + 1),
  };
}

function hasProperties(schema: JSONSchema7): boolean {
  return Object.keys(schema.properties ?? {}).length > 0;
}

/**
 * The EndpointType per exposable visibility as the form presents it: the
 * developer's choice or the default, except that a visibility with exactly one
 * allowed EndpointType always uses it, since the form offers no choice there.
 */
export function formEndpointTypes(
  endpoint: ExposableEndpoint,
  allowedEndpoints: AllowedEndpointTypeEntry[],
  choice?: EndpointExposureChoice,
): Record<string, string> {
  const types = resolveEndpointTypes(endpoint, allowedEndpoints, choice);
  for (const visibility of Object.keys(types)) {
    const candidates = endpointTypeCandidates(
      endpoint.type,
      visibility,
      allowedEndpoints,
    );
    if (candidates.length === 1) {
      types[visibility] = endpointTypeKey(candidates[0].ref);
    }
  }
  return types;
}

/**
 * The exposures the form submits: one explicit choice per workload endpoint
 * that can be exposed, so the scaffolder action creates exactly what the form
 * showed. Choices for endpoints that no longer exist are dropped.
 */
export function formExposures(
  endpoints: Record<string, ExposableEndpoint>,
  allowedEndpoints: AllowedEndpointTypeEntry[],
  exposures: EndpointExposures,
): EndpointExposures {
  if (allowedEndpoints.length === 0) {
    return {};
  }
  const out: EndpointExposures = {};
  for (const [name, endpoint] of Object.entries(endpoints)) {
    if (exposableVisibilities(endpoint).length === 0) continue;
    out[name] = {
      types: formEndpointTypes(endpoint, allowedEndpoints, exposures[name]),
      ...(exposures[name]?.parameters && {
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
    for (const key of Object.values(choice.types)) {
      if (key !== NO_ENDPOINT) keys.add(key);
    }
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
      const { kind, name } = splitKey(key);
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
  endpoint: ExposableEndpoint;
  allowedEndpoints: AllowedEndpointTypeEntry[];
  choice?: EndpointExposureChoice;
  schemas: Record<string, SchemaState>;
  onChange: (choice: EndpointExposureChoice) => void;
}

/**
 * How one workload endpoint is exposed, shown inside its row: a dropdown for
 * each visibility where more than one EndpointType is allowed, then for each
 * EndpointType in use its name as a heading followed by its parameters.
 */
export const EndpointExposure = ({
  endpoint,
  allowedEndpoints,
  choice,
  schemas,
  onChange,
}: EndpointExposureProps) => {
  const classes = useStyles();
  const visibilities = exposableVisibilities(endpoint);
  if (visibilities.length === 0) {
    return null;
  }

  const types = formEndpointTypes(endpoint, allowedEndpoints, choice);
  const keys = [...new Set(Object.values(types))].filter(
    k => k !== NO_ENDPOINT,
  );

  const setType = (visibility: string, key: string) =>
    onChange({ ...choice, types: { ...types, [visibility]: key } });

  const setParameters = (key: string, parameters: Record<string, unknown>) =>
    onChange({
      types,
      parameters: { ...choice?.parameters, [key]: parameters },
    });

  // Only a visibility with a real choice gets a dropdown; a single allowed
  // EndpointType is simply used.
  const choosable = visibilities.filter(
    v => endpointTypeCandidates(endpoint.type, v, allowedEndpoints).length > 1,
  );
  // With one EndpointType in use the header names it alone; with several,
  // each header says which visibilities it exposes.
  const visibilitiesOf = (key: string) =>
    visibilities.filter(v => types[v] === key).join(', ');

  return (
    <Box>
      {choosable.map(visibility => (
        <Box key={visibility} className={classes.choice}>
          <TextField
            select
            variant="outlined"
            size="small"
            className={classes.select}
            label={`Endpoint type (${visibility})`}
            value={types[visibility]}
            onChange={e => setType(visibility, e.target.value)}
          >
            {endpointTypeCandidates(
              endpoint.type,
              visibility,
              allowedEndpoints,
            ).map(entry => (
              <MenuItem
                key={endpointTypeKey(entry.ref)}
                value={endpointTypeKey(entry.ref)}
              >
                {typeLabel(entry)}
              </MenuItem>
            ))}
            <MenuItem value={NO_ENDPOINT}>
              No Endpoint (component type routes)
            </MenuItem>
          </TextField>
        </Box>
      ))}

      {keys.map(key => {
        const schema = schemas[key];
        const { name: typeName } = splitKey(key);
        let parameters;
        if (schema === 'loading' || schema === undefined) {
          parameters = <CircularProgress size={20} />;
        } else if (schema === 'error') {
          parameters = (
            <Alert severity="warning">
              Could not load the parameters of {typeName}; its defaults will be
              used.
            </Alert>
          );
        } else if (hasProperties(schema)) {
          parameters = (
            <>
              <Typography className={classes.parametersHeading}>
                Parameters
              </Typography>
              <RjsfForm
                schema={schema}
                uiSchema={generateUiSchemaWithTitles(schema)}
                formData={choice?.parameters?.[key] ?? {}}
                onChange={(e: any) => setParameters(key, e.formData ?? {})}
                tagName="div"
              />
            </>
          );
        }
        return (
          <Box key={key} className={classes.typeBlock}>
            <Typography className={classes.typeHeading}>
              EndpointType: {typeName}
              {keys.length > 1 && (
                <span className={classes.typeVisibilities}>
                  {' '}
                  ({visibilitiesOf(key)})
                </span>
              )}
            </Typography>
            {parameters}
          </Box>
        );
      })}
    </Box>
  );
};

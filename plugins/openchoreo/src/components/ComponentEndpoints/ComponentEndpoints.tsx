import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import AddIcon from '@material-ui/icons/Add';
import { EmptyState } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import {
  EntityRefLink,
  catalogApiRef,
  useEntity,
} from '@backstage/plugin-catalog-react';
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import { useNavigate } from 'react-router-dom';
import { CHOREO_ANNOTATIONS } from '@openchoreo/backstage-plugin-common';
import { PageLoader, StatusBadge } from '@openchoreo/backstage-design-system';
import {
  useCreateEndpointPath,
  useEndpointCreatePermission,
} from '@openchoreo/backstage-plugin-react';
import {
  openChoreoClientApiRef,
  type EndpointEnvironment,
} from '../../api/OpenChoreoClientApi';
import { getErrorMessage } from '../../utils/errorUtils';
import {
  trafficShares,
  type EndpointBackend,
} from '../EndpointOverview/EndpointRoutingCard';
import { deriveEndpointEnvBadgeStatus } from '../EndpointEnvironments/endpointEnvironmentUtils';

const useStyles = makeStyles(theme => ({
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing(2),
    gap: theme.spacing(2),
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
  },
}));

/** One Endpoint routing to this component, with its per-environment view. */
interface ComponentEndpointRow {
  entity: Entity;
  /** The backends that point at this component, with their traffic share. */
  routes: Array<EndpointBackend & { share: number }>;
  environments?: EndpointEnvironment[];
  environmentsError?: string;
}

/** Picks the backends of an Endpoint that route to `component`. */
export function routesToComponent(
  endpoint: Entity,
  component: string,
): Array<EndpointBackend & { share: number }> {
  const backends =
    (endpoint.spec as { backends?: EndpointBackend[] } | undefined)?.backends ??
    [];
  const shares = trafficShares(backends);
  return backends
    .map((b, i) => ({ ...b, share: shares[i] }))
    .filter(b => b.component === component);
}

/**
 * Describes one environment for this component: the Endpoint's status there
 * and whether this component's backends resolved.
 */
export function describeEnvironment(
  env: EndpointEnvironment,
  routeNames: string[],
): string {
  if (!env.bindingName) return `${env.name}: not deployed`;
  const ours = (env.backends ?? []).filter(b => routeNames.includes(b.name));
  const unresolved = ours.filter(b => !b.resolved);
  const status = env.status ?? 'Unknown';
  if (ours.length === 0) return `${env.name}: ${status}`;
  if (unresolved.length === 0) {
    return `${env.name}: ${status}, this component's backend resolved`;
  }
  const reasons = unresolved
    .map(b => [b.name, b.reason].filter(Boolean).join(': '))
    .join('; ');
  return `${env.name}: ${status}, not resolved (${reasons})`;
}

function formatShare(share: number): string {
  return Number.isInteger(share) ? `${share}%` : `${share.toFixed(1)}%`;
}

/**
 * Endpoints tab of a Component: the Endpoints whose backends route to this
 * component, found through the catalog's routedBy relation, with the share of
 * traffic each sends here and its status per environment.
 */
export const ComponentEndpoints = () => {
  const classes = useStyles();
  const { entity } = useEntity();
  const catalogApi = useApi(catalogApiRef);
  const client = useApi(openChoreoClientApiRef);
  const navigate = useNavigate();

  const componentName =
    entity.metadata.annotations?.[CHOREO_ANNOTATIONS.COMPONENT] ??
    entity.metadata.name;
  const projectName =
    entity.metadata.annotations?.[CHOREO_ANNOTATIONS.PROJECT] ?? '';
  const { path: createPath } = useCreateEndpointPath(entity, projectName);
  const {
    canCreate,
    loading: permLoading,
    createDeniedTooltip,
  } = useEndpointCreatePermission();

  const [rows, setRows] = useState<ComponentEndpointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      const { items } = await catalogApi.getEntities({
        filter: {
          kind: 'Endpoint',
          'relations.routesto': stringifyEntityRef(entity),
        },
      });
      const base = items.map(ep => ({
        entity: ep,
        routes: routesToComponent(ep, componentName),
      }));
      if (cancelled) return;
      setRows(base);
      setLoading(false);

      // Environments load per Endpoint so one failure does not hide the rest.
      const withEnvs = await Promise.all(
        base.map(async row => {
          try {
            return {
              ...row,
              environments: await client.fetchEndpointEnvironmentInfo(
                row.entity,
              ),
            };
          } catch (err) {
            return { ...row, environmentsError: getErrorMessage(err) };
          }
        }),
      );
      if (!cancelled) setRows(withEnvs);
    };

    load().catch(err => {
      if (cancelled) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [catalogApi, client, entity, componentName]);

  const createButton = (
    <Tooltip title={!permLoading && !canCreate ? createDeniedTooltip : ''}>
      <span>
        <Button
          variant="outlined"
          color="primary"
          size="small"
          startIcon={<AddIcon />}
          disabled={permLoading || !canCreate || !projectName}
          onClick={() => navigate(createPath)}
        >
          Create Endpoint
        </Button>
      </span>
    </Tooltip>
  );

  if (loading) return <PageLoader />;
  if (error) {
    return (
      <EmptyState
        missing="data"
        title="Failed to load endpoints"
        description={getErrorMessage(error)}
      />
    );
  }

  return (
    <Box>
      <Box className={classes.header}>
        <Box>
          <Typography variant="h6">Endpoints ({rows.length})</Typography>
          <Typography variant="body2" color="textSecondary">
            Endpoints that route traffic to {componentName}.
          </Typography>
        </Box>
        {createButton}
      </Box>

      {rows.length === 0 ? (
        <EmptyState
          missing="content"
          title="No endpoints route to this component"
          description="Create an Endpoint to expose its internal or external workload endpoints through a gateway."
        />
      ) : (
        <Table size="small" aria-label="Endpoints routing to this component">
          <TableHead>
            <TableRow>
              <TableCell>Endpoint</TableCell>
              <TableCell>Visibility</TableCell>
              <TableCell>Routes to {componentName}</TableCell>
              <TableCell>Environments</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(row => {
              const spec = (row.entity.spec ?? {}) as {
                type?: string;
                visibility?: string[];
              };
              const routeNames = row.routes.map(r => r.name);
              return (
                <TableRow key={stringifyEntityRef(row.entity)}>
                  <TableCell>
                    <EntityRefLink entityRef={row.entity} />
                    {spec.type && (
                      <Typography
                        variant="caption"
                        color="textSecondary"
                        component="div"
                      >
                        {spec.type}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box className={classes.chips}>
                      {(spec.visibility ?? []).map(v => (
                        <Chip
                          key={v}
                          size="small"
                          variant="outlined"
                          label={v}
                        />
                      ))}
                    </Box>
                  </TableCell>
                  <TableCell>
                    {row.routes.map(r => (
                      <Typography key={r.name} variant="body2">
                        {r.endpoint ?? r.name} · {formatShare(r.share)}
                      </Typography>
                    ))}
                  </TableCell>
                  <TableCell>
                    {row.environmentsError && (
                      <Typography variant="caption" color="error">
                        {row.environmentsError}
                      </Typography>
                    )}
                    {!row.environments && !row.environmentsError && (
                      <Typography variant="caption" color="textSecondary">
                        Loading…
                      </Typography>
                    )}
                    <Box className={classes.chips}>
                      {(row.environments ?? []).map(env => (
                        <Tooltip
                          key={env.name}
                          title={describeEnvironment(env, routeNames)}
                        >
                          <Box display="flex" alignItems="center" gridGap={4}>
                            <Typography variant="caption">
                              {env.name}
                            </Typography>
                            <StatusBadge
                              status={deriveEndpointEnvBadgeStatus(env)}
                            />
                          </Box>
                        </Tooltip>
                      ))}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};

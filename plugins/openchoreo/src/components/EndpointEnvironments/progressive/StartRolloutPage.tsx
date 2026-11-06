import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import { Alert } from '@material-ui/lab';
import CallSplitIcon from '@material-ui/icons/CallSplit';
import SwapHorizIcon from '@material-ui/icons/SwapHoriz';
import GroupWorkIcon from '@material-ui/icons/GroupWork';
import FileCopyOutlinedIcon from '@material-ui/icons/FileCopyOutlined';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { useAsyncEntity, useEntity } from '@backstage/plugin-catalog-react';
import { Skeleton } from '@openchoreo/backstage-design-system';
import {
  DetailPageLayout,
  ForbiddenState,
} from '@openchoreo/backstage-plugin-react';
import {
  abAudience,
  audienceProblem,
  backendMatchProblems,
  CHOREO_ANNOTATIONS,
  DEFAULT_CANARY_STEPS,
  isSameBackend,
  planRollout,
  type EndpointBackendWeight,
  type EndpointHeaderMatch,
  type RolloutPlan,
  type RolloutStrategy,
} from '@openchoreo/backstage-plugin-common';
import type { EndpointSummary } from './pdTypes';
import { envResourceName } from '../endpointEnvironmentUtils';
import { StrategyFlow, toFlowVersion } from './StrategyFlow';
import { StepsField, normalizeSteps } from './StepsField';
import { useProjectWorkloadEndpoints } from '../../../scaffolder/EndpointBackendsField/useProjectWorkloadEndpoints';
import { openChoreoClientApiRef } from '../../../api/OpenChoreoClientApi';
import { getErrorMessage, isForbiddenError } from '../../../utils/errorUtils';
import { backendColor } from './endpointUi';
import { STRATEGY_COPY } from './endpointRolloutUi';

const useStyles = makeStyles(theme => ({
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    padding: theme.spacing(4),
  },
  formCard: {
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 12,
    padding: theme.spacing(3),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(3),
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  label: { fontWeight: 600 },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    gap: theme.spacing(3),
    alignItems: 'start',
    [theme.breakpoints.down('sm')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  preview: {
    fontFamily: 'monospace',
    fontSize: 12,
    whiteSpace: 'pre',
    overflowX: 'auto',
    margin: 0,
    padding: theme.spacing(1.5),
    borderRadius: 8,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.default,
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: theme.spacing(1.5),
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  card: {
    textAlign: 'left',
    padding: theme.spacing(2),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    background: 'none',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    color: theme.palette.text.primary,
    font: 'inherit',
    '&:hover': { borderColor: theme.palette.primary.main },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  },
  selected: {
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 1px ${theme.palette.primary.main}`,
  },
  audience: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 160px minmax(0, 1fr)',
    gap: theme.spacing(1),
    maxWidth: 640,
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: theme.spacing(2),
    maxWidth: 640,
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
}));

/** Header conditions to start from; each fills the fields and can be edited. */
const AUDIENCE_PRESETS: {
  label: string;
  header: EndpointHeaderMatch;
  hint: string;
}[] = [
  {
    label: 'Phones',
    header: {
      name: 'user-agent',
      type: 'RegularExpression',
      value: '.*Mobi.*',
    },
    hint: "Browsers on phones put 'Mobi' in their User-Agent. iPads and apps that send their own User-Agent are missed.",
  },
  {
    label: 'Chromium on mobile',
    header: { name: 'sec-ch-ua-mobile', type: 'Exact', value: '?1' },
    hint: 'Chrome, Edge and other Chromium browsers send this hint on mobile; Safari and Firefox do not.',
  },
  {
    label: 'Your app',
    header: { name: 'X-Client', type: 'Exact', value: 'ios' },
    hint: 'Use the header your app already sends, such as X-Client: ios. The most reliable choice for native apps.',
  },
];

const ICONS: Record<RolloutStrategy, JSX.Element> = {
  canary: <CallSplitIcon color="primary" />,
  blueGreen: <SwapHorizIcon color="primary" />,
  abTest: <GroupWorkIcon color="primary" />,
  mirror: <FileCopyOutlinedIcon color="primary" />,
};

const candidateKeyOf = (
  component: string,
  endpoint: string,
  releaseLine?: string,
) => `${component}@${releaseLine ?? ''}/${endpoint}`;

/** The backendRefs the page will save, as the Endpoint spec shows them. */
function backendsYaml(backends: EndpointBackendWeight[]): string {
  const lines = ['backendRefs:'];
  for (const b of backends) {
    lines.push(`- name: ${b.name ?? b.componentName}`);
    lines.push(
      `  component: {name: ${b.componentName}, endpoint: ${b.endpoint}${
        b.releaseLine ? `, releaseLine: ${b.releaseLine}` : ''
      }}`,
    );
    lines.push(`  weight: ${b.weight}`);
    if (b.match) {
      lines.push('  match:');
      if (b.match.path) {
        lines.push(
          `    path: {type: ${b.match.path.type ?? 'PathPrefix'}, value: ${
            b.match.path.value
          }}`,
        );
      }
      if (b.match.headers?.length) {
        lines.push('    headers:');
        for (const h of b.match.headers) {
          lines.push(
            `    - {name: ${h.name}, type: ${h.type ?? 'Exact'}, value: "${
              h.value
            }"}`,
          );
        }
      }
      if (b.match.cookies?.length) {
        lines.push('    cookies:');
        for (const c of b.match.cookies) {
          lines.push(`    - {name: ${c.name}, value: ${c.value}}`);
        }
      }
    }
    if (b.mirror) lines.push(`  mirror: {percent: ${b.mirror.percent}}`);
  }
  return lines.join('\n');
}

/**
 * Adds a backend to the Endpoint and chooses how it gets traffic, from the
 * Deploy tab's Set up pane, on the Configure Resource page's layout: one
 * page with a section per decision (strategy, new backend, how people reach
 * it), and what will be saved next to it. Saving cuts a release with the
 * new backend at 0%, deployed and promoted like any other, so nothing moves
 * until an environment is stepped. With `editing`, the same page changes
 * the rollout's settings before it is deployed.
 */
export const StartRolloutPage = ({
  editing = false,
}: { editing?: boolean } = {}) => {
  const classes = useStyles();
  const theme = useTheme();
  const navigate = useNavigate();
  const { entity } = useEntity();
  const { refresh: refreshEntity } = useAsyncEntity();
  const client = useApi(openChoreoClientApiRef);
  const project = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.PROJECT];
  const namespace = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.NAMESPACE];

  const [endpoint, setEndpoint] = useState<EndpointSummary | null>(null);
  const [firstEnvironment, setFirstEnvironment] = useState<{
    name: string;
    label: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [strategy, setStrategy] = useState<RolloutStrategy>('canary');
  const [candidateKey, setCandidateKey] = useState('');
  const [steps, setSteps] = useState<number[]>(DEFAULT_CANARY_STEPS);
  const [useHeader, setUseHeader] = useState(true);
  const [headerName, setHeaderName] = useState('x-canary');
  const [headerValue, setHeaderValue] = useState('true');
  const [previewBy, setPreviewBy] = useState<'header' | 'path'>('header');
  const [previewPath, setPreviewPath] = useState('/preview');
  const [mirrorPercent, setMirrorPercent] = useState('100');
  const [cookieName, setCookieName] = useState('');
  const [cookieValue, setCookieValue] = useState('b');
  // A/B: a header the cookie group must also send, as Flagger's
  // analysis.match and Argo Rollouts' setHeaderRoute allow.
  const [audienceOn, setAudienceOn] = useState(false);
  const [audience, setAudience] = useState<EndpointHeaderMatch>({
    name: 'user-agent',
    type: 'RegularExpression',
    value: '.*Mobi.*',
  });
  const [replaces, setReplaces] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const back = useCallback(
    () => navigate('..', { relative: 'path' }),
    [navigate],
  );

  useEffect(() => {
    let ignore = false;
    Promise.all([
      client.fetchEndpointRollout(entity),
      client.fetchEndpointEnvironmentInfo(entity),
    ])
      .then(([summary, envInfo]) => {
        if (ignore) return;
        setEndpoint(summary);
        const first = envInfo?.[0];
        setFirstEnvironment(
          first ? { name: envResourceName(first), label: first.name } : null,
        );
        setCookieName(
          `exp_${entity.metadata.name.replace(/[^A-Za-z0-9_]/g, '_')}`,
        );
        const running = summary?.rollout;
        if (editing && running) {
          const next = summary.backends.find(
            b => (b.name ?? b.componentName) === running.candidate,
          );
          const p = running.preview;
          setStrategy(running.strategy);
          setReplaces(running.stable);
          setSteps(normalizeSteps(running.steps));
          setUseHeader(p?.kind === 'header');
          setPreviewBy(p?.kind === 'path' ? 'path' : 'header');
          if (p?.kind === 'header') {
            setHeaderName(p.name);
            setHeaderValue(p.value);
          }
          if (p?.kind === 'path') setPreviewPath(p.value);
          if (p?.kind === 'cookie') {
            setCookieName(p.name);
            setCookieValue(p.value);
          }
          const audienceHeader = abAudience(p);
          setAudienceOn(Boolean(audienceHeader));
          if (audienceHeader) setAudience(audienceHeader);
          if (next?.mirror) setMirrorPercent(String(next.mirror.percent));
        }
      })
      .catch(err => !ignore && setLoadError(err));
    return () => {
      ignore = true;
    };
  }, [client, entity, editing]);

  const { options: workloadEndpoints } = useProjectWorkloadEndpoints(
    namespace,
    project,
    { includeReleaseLines: true },
  );

  useEffect(() => {
    if (editing) return;
    setHeaderName(strategy === 'blueGreen' ? 'x-preview' : 'x-canary');
    setHeaderValue(strategy === 'blueGreen' ? 'green' : 'true');
    setUseHeader(strategy !== 'abTest');
  }, [strategy, editing]);

  // Any workload endpoint but the backends serving now, on a component's
  // main line or a release line; one left at 0% by an earlier rollout can be
  // added again.
  const current = new Set(
    endpoint?.backends
      .filter(b => b.weight > 0)
      .map(b => candidateKeyOf(b.componentName, b.endpoint, b.releaseLine)) ??
      [],
  );
  const options = workloadEndpoints
    .map(o => ({
      key: candidateKeyOf(o.component, o.endpoint, o.releaseLine),
      ...o,
    }))
    .filter(o => !current.has(o.key));
  const picked = options.find(o => o.key === candidateKey);
  const running = editing
    ? endpoint?.backends.find(
        b => (b.name ?? b.componentName) === endpoint.rollout?.candidate,
      )
    : undefined;
  const component = running?.componentName ?? picked?.component ?? '';
  const endpointKey = running?.endpoint ?? picked?.endpoint ?? '';
  const releaseLine = running ? running.releaseLine : picked?.releaseLine;
  const owner = (entity.spec as { managedByComponent?: string } | undefined)
    ?.managedByComponent;
  const movesToProject = Boolean(owner && component && component !== owner);
  // The new backend replaces one serving backend, by default the busiest;
  // the others keep their traffic, as on an Argo Rollouts or Flagger route.
  const serving = endpoint?.backends.filter(b => b.weight > 0) ?? [];
  const servingTotal = serving.reduce((sum, b) => sum + b.weight, 0);
  const nameOf = (b: { name?: string; componentName: string }) =>
    b.name ?? b.componentName;
  const busiest = [...serving].sort((a, b) => b.weight - a.weight)[0];
  const replaced =
    serving.find(b => nameOf(b) === replaces) ?? busiest ?? undefined;
  const replacedName = replaced ? nameOf(replaced) : undefined;
  const stable = replacedName ?? 'the current backend';

  const plan = useMemo((): RolloutPlan | null => {
    if (!component || !endpointKey) return null;
    const candidate = {
      componentName: component,
      endpoint: endpointKey,
      ...(releaseLine && { releaseLine }),
    };
    if (strategy === 'abTest') {
      return cookieName && cookieValue
        ? {
            strategy,
            candidate,
            ...(replacedName && { replaces: replacedName }),
            preview: {
              kind: 'cookie',
              name: cookieName,
              value: cookieValue,
              ...(audienceOn && { audience }),
            },
          }
        : null;
    }
    if (strategy === 'mirror') {
      const percent = Number(mirrorPercent);
      return Number.isInteger(percent) && percent > 0 && percent <= 100
        ? {
            strategy,
            candidate,
            ...(replacedName && { replaces: replacedName }),
            mirrorPercent: percent,
          }
        : null;
    }
    if (strategy === 'blueGreen' && previewBy === 'path') {
      return previewPath
        ? {
            strategy,
            candidate,
            ...(replacedName && { replaces: replacedName }),
            preview: { kind: 'path', name: 'path', value: previewPath },
          }
        : null;
    }
    if (strategy === 'blueGreen' && (!headerName || !headerValue)) return null;
    if (strategy === 'canary' && steps.length === 0) return null;
    return {
      strategy,
      candidate,
      ...(replacedName && { replaces: replacedName }),
      ...(strategy === 'canary' && { steps: steps }),
      ...((strategy === 'blueGreen' || useHeader) &&
        headerName &&
        headerValue && {
          preview: {
            kind: 'header' as const,
            name: headerName,
            value: headerValue,
          },
        }),
    };
  }, [
    strategy,
    component,
    releaseLine,
    endpointKey,
    cookieName,
    cookieValue,
    audienceOn,
    audience,
    headerName,
    headerValue,
    useHeader,
    steps,
    replacedName,
    mirrorPercent,
    previewBy,
    previewPath,
  ]);

  const saved = useMemo(
    () =>
      endpoint && plan ? planRollout(endpoint.backends, plan).backends : [],
    [endpoint, plan],
  );
  const savedCandidate = saved.find(b =>
    isSameBackend(b, {
      componentName: component,
      endpoint: endpointKey,
      releaseLine,
    }),
  );
  const matchProblem = savedCandidate?.match
    ? backendMatchProblems(savedCandidate.match)[0]
    : undefined;

  const start = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const { latestRelease } = editing
        ? await client.updateRolloutSettings(entity, {
            steps: plan.steps,
            preview: plan.preview,
            mirrorPercent: plan.mirrorPercent,
          })
        : await client.startRollout(entity, plan);
      if (latestRelease && firstEnvironment) {
        await client.deployEndpointRelease(
          entity,
          firstEnvironment.name,
          latestRelease,
        );
      }
      [0, 3000, 8000].forEach(ms => setTimeout(() => refreshEntity?.(), ms));
      back();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (isForbiddenError(loadError)) {
    return (
      <ForbiddenState
        message="You do not have permission to change this endpoint."
        minHeight="400px"
      />
    );
  }

  let blocked = '';
  if (editing && endpoint && !endpoint.rollout)
    blocked = 'No rollout is running';
  else if (!editing && endpoint?.rollout)
    blocked = 'A rollout is already running';
  else if (!component) blocked = 'Pick the new backend';
  else if (strategy === 'abTest' && audienceOn && audienceProblem(audience))
    blocked = audienceProblem(audience)!;
  else if (!plan) blocked = 'Fill in how to reach the new backend';
  else if (matchProblem) blocked = matchProblem;

  const actions = endpoint && (
    <Tooltip title={blocked}>
      <span>
        <Button
          variant="contained"
          color="primary"
          disabled={busy || Boolean(blocked)}
          startIcon={
            busy ? <CircularProgress size={20} color="inherit" /> : undefined
          }
          onClick={() => void start()}
        >
          {busy ? 'Deploying' : 'Save & Deploy'}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <DetailPageLayout
      title={editing ? 'Rollout settings' : 'Add a backend'}
      subtitle={
        editing
          ? 'Change how people reach the new version and its steps before the rollout is deployed.'
          : `The new backend joins at 0% and the release is deployed to ${
              firstEnvironment?.label ?? 'the first environment'
            }. Promote it onward and step each environment from Configure.`
      }
      onBack={back}
      actions={actions}
    >
      {!endpoint && !loadError && (
        <Box className={classes.loadingContainer}>
          <Skeleton variant="rect" width="100%" height={96} />
          <Skeleton variant="rect" width="100%" height={120} />
        </Box>
      )}
      {loadError && (
        <Alert severity="error">
          Failed to load the endpoint: {getErrorMessage(loadError)}
        </Alert>
      )}
      {error && (
        <Box mb={2}>
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        </Box>
      )}
      {!editing && endpoint?.rollout && (
        <Box mb={2}>
          <Alert severity="info">
            A rollout is already running on this Endpoint. Finish it first by
            removing the Current or New backend on the Set up pane.
          </Alert>
        </Box>
      )}

      {endpoint && (
        <Box className={classes.layout}>
          <Box className={classes.formCard}>
            {editing && (
              <Box className={classes.field}>
                <Typography variant="body2" className={classes.label}>
                  {STRATEGY_COPY[strategy].name}
                </Typography>
                <Typography variant="body2">
                  {releaseLine ? `${component} · ${releaseLine}` : component}{' '}
                  next to {stable}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  To use another strategy or backend, remove the new version
                  from the Set up card first.
                </Typography>
              </Box>
            )}
            {!editing && (
              <Box className={classes.field}>
                <Typography variant="body2" className={classes.label}>
                  Strategy
                </Typography>
                <Box className={classes.cards} role="radiogroup">
                  {(Object.keys(STRATEGY_COPY) as RolloutStrategy[]).map(
                    kind => (
                      <button
                        type="button"
                        key={kind}
                        role="radio"
                        aria-checked={strategy === kind}
                        className={`${classes.card} ${
                          strategy === kind ? classes.selected : ''
                        }`}
                        onClick={() => setStrategy(kind)}
                      >
                        {ICONS[kind]}
                        <Typography variant="subtitle2">
                          {STRATEGY_COPY[kind].name}
                        </Typography>
                        <Typography variant="body2">
                          {STRATEGY_COPY[kind].question}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {STRATEGY_COPY[kind].pitch}
                        </Typography>
                      </button>
                    ),
                  )}
                </Box>
              </Box>
            )}

            <Box className={classes.field}>
              {!editing && (
                <>
                  <Typography variant="body2" className={classes.label}>
                    New backend
                  </Typography>
                  <Box className={classes.pair}>
                    <TextField
                      id="rollout-candidate"
                      select
                      size="small"
                      variant="outlined"
                      label="Component and endpoint"
                      value={candidateKey}
                      onChange={e => setCandidateKey(e.target.value)}
                      helperText={`Workload endpoints in ${
                        project ?? 'this project'
                      }, including release lines. Starts next to ${stable} at 0%.`}
                    >
                      {options.length === 0 && (
                        <MenuItem value="" disabled>
                          No other workload endpoints in this project
                        </MenuItem>
                      )}
                      {options.map(o => (
                        <MenuItem key={o.key} value={o.key}>
                          {o.releaseLine
                            ? `${o.component} (release line ${o.releaseLine})`
                            : o.component}{' '}
                          · {o.endpoint}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                  {movesToProject && (
                    <Alert severity="info">
                      This Endpoint belongs to {owner}. Routing to {component}{' '}
                      moves it to the project. A release line of {owner} keeps
                      it with the component.
                    </Alert>
                  )}
                </>
              )}
              {strategy === 'canary' && (
                <Box>
                  <Typography variant="body2" className={classes.label}>
                    Steps
                  </Typography>
                  <StepsField value={steps} onChange={setSteps} />
                </Box>
              )}
            </Box>

            {!editing && serving.length > 1 && (
              <Box className={classes.field}>
                <Typography variant="body2" className={classes.label}>
                  Replaces
                </Typography>
                <RadioGroup
                  aria-label="Version to replace"
                  value={stable}
                  onChange={e => setReplaces(e.target.value)}
                >
                  {serving.map(b => (
                    <FormControlLabel
                      key={nameOf(b)}
                      value={nameOf(b)}
                      control={<Radio color="primary" size="small" />}
                      label={`${nameOf(b)} · ${Math.round(
                        (b.weight / servingTotal) * 100,
                      )}% of traffic`}
                    />
                  ))}
                </RadioGroup>
                <Typography variant="caption" color="textSecondary">
                  The new version takes traffic only from this one. Other
                  versions keep their traffic and stay after the rollout
                  completes.
                </Typography>
              </Box>
            )}

            <Box className={classes.field}>
              <Typography variant="body2" className={classes.label}>
                {strategy === 'abTest' && 'Who sees the new backend'}
                {strategy === 'mirror' && 'How much to copy'}
                {(strategy === 'canary' || strategy === 'blueGreen') &&
                  'Let testers reach it first'}
              </Typography>
              {matchProblem && (
                <Typography variant="caption" color="error">
                  {matchProblem}
                </Typography>
              )}
              {strategy === 'mirror' && (
                <>
                  <Box maxWidth={316}>
                    <TextField
                      id="rollout-mirror-percent"
                      select
                      fullWidth
                      size="small"
                      variant="outlined"
                      label="Copy this share of live traffic"
                      value={mirrorPercent}
                      onChange={e => setMirrorPercent(e.target.value)}
                    >
                      {['100', '50', '25', '10', '5'].map(p => (
                        <MenuItem key={p} value={p}>
                          {p}%
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                  <Typography variant="caption" color="textSecondary">
                    Users always get {stable}'s answer; the new backend's
                    answers are discarded. Copies of writes (POST, PUT) run too,
                    so give it its own database.
                  </Typography>
                </>
              )}
              {strategy === 'blueGreen' && (
                <RadioGroup
                  row
                  aria-label="Preview with"
                  value={previewBy}
                  onChange={e =>
                    setPreviewBy(e.target.value as 'header' | 'path')
                  }
                >
                  <FormControlLabel
                    value="header"
                    control={<Radio color="primary" size="small" />}
                    label="A header"
                  />
                  <FormControlLabel
                    value="path"
                    control={<Radio color="primary" size="small" />}
                    label="A path under the Endpoint's"
                  />
                </RadioGroup>
              )}
              {strategy === 'blueGreen' && previewBy === 'path' && (
                <Box maxWidth={316}>
                  <TextField
                    id="rollout-preview-path"
                    fullWidth
                    size="small"
                    variant="outlined"
                    label="Path"
                    value={previewPath}
                    onChange={e => setPreviewPath(e.target.value)}
                    helperText="Relative to the Endpoint's own path, e.g. /preview"
                  />
                </Box>
              )}
              {strategy === 'canary' && (
                <FormControlLabel
                  control={
                    <Checkbox
                      color="primary"
                      checked={useHeader}
                      onChange={e => setUseHeader(e.target.checked)}
                    />
                  }
                  label="Requests with a header always reach the new version"
                />
              )}
              {((strategy === 'blueGreen' && previewBy === 'header') ||
                (strategy === 'canary' && useHeader)) && (
                <Box className={classes.pair}>
                  <TextField
                    id="rollout-header-name"
                    size="small"
                    variant="outlined"
                    label="Header"
                    value={headerName}
                    onChange={e => setHeaderName(e.target.value)}
                  />
                  <TextField
                    id="rollout-header-value"
                    size="small"
                    variant="outlined"
                    label="Value"
                    value={headerValue}
                    onChange={e => setHeaderValue(e.target.value)}
                  />
                </Box>
              )}
              {strategy === 'abTest' && (
                <>
                  <Box className={classes.pair}>
                    <TextField
                      id="rollout-cookie-name"
                      size="small"
                      variant="outlined"
                      label="Cookie your app sets"
                      value={cookieName}
                      onChange={e => setCookieName(e.target.value)}
                    />
                    <TextField
                      id="rollout-cookie-value"
                      size="small"
                      variant="outlined"
                      label="Value for the new version's group"
                      value={cookieValue}
                      onChange={e => setCookieValue(e.target.value)}
                    />
                  </Box>
                  <Typography variant="caption" color="textSecondary">
                    Your app gives each visitor this cookie once, so a visitor
                    always sees the same version.
                  </Typography>
                  <Typography variant="body2" className={classes.label}>
                    Who takes part
                  </Typography>
                  <RadioGroup
                    aria-label="Who takes part"
                    value={audienceOn ? 'header' : 'everyone'}
                    onChange={e => setAudienceOn(e.target.value === 'header')}
                  >
                    <FormControlLabel
                      value="everyone"
                      control={<Radio color="primary" size="small" />}
                      label="Everyone in the cookie group"
                    />
                    <FormControlLabel
                      value="header"
                      control={<Radio color="primary" size="small" />}
                      label="Only requests that also send a header"
                    />
                  </RadioGroup>
                  {audienceOn && (
                    <>
                      <Box display="flex" flexWrap="wrap" gridGap={8}>
                        {AUDIENCE_PRESETS.map(p => (
                          <Button
                            key={p.label}
                            size="small"
                            variant="outlined"
                            onClick={() => setAudience(p.header)}
                          >
                            {p.label}
                          </Button>
                        ))}
                      </Box>
                      <Box className={classes.audience}>
                        <TextField
                          id="rollout-audience-name"
                          size="small"
                          variant="outlined"
                          label="Header"
                          value={audience.name}
                          onChange={e =>
                            setAudience(a => ({ ...a, name: e.target.value }))
                          }
                        />
                        <TextField
                          id="rollout-audience-type"
                          select
                          size="small"
                          variant="outlined"
                          label="Match"
                          value={audience.type ?? 'Exact'}
                          onChange={e =>
                            setAudience(a => ({
                              ...a,
                              type: e.target
                                .value as EndpointHeaderMatch['type'],
                            }))
                          }
                        >
                          <MenuItem value="Exact">is exactly</MenuItem>
                          <MenuItem value="RegularExpression">
                            matches regex
                          </MenuItem>
                        </TextField>
                        <TextField
                          id="rollout-audience-value"
                          size="small"
                          variant="outlined"
                          label="Value"
                          value={audience.value}
                          error={Boolean(audienceProblem(audience))}
                          helperText={audienceProblem(audience)}
                          onChange={e =>
                            setAudience(a => ({ ...a, value: e.target.value }))
                          }
                        />
                      </Box>
                      <Typography variant="caption" color="textSecondary">
                        {AUDIENCE_PRESETS.find(
                          p =>
                            p.header.name === audience.name &&
                            p.header.value === audience.value,
                        )?.hint ??
                          'Both the cookie and this header must match. A header your app sends is the most reliable.'}
                      </Typography>
                    </>
                  )}
                </>
              )}
            </Box>
          </Box>
          {plan && (
            <Box className={classes.field}>
              <Typography variant="body2" className={classes.label}>
                How requests will flow
              </Typography>
              <StrategyFlow
                strategy={plan.strategy}
                preview={plan.preview}
                current={toFlowVersion(
                  replaced ?? { componentName: stable },
                  plan.candidate,
                  backendColor(theme, 0),
                )}
                next={toFlowVersion(
                  plan.candidate,
                  replaced,
                  backendColor(theme, 1),
                )}
              />
            </Box>
          )}
          <Box className={classes.field}>
            <Typography variant="body2" className={classes.label}>
              What will be saved
            </Typography>
            <pre className={classes.preview}>
              {saved.length > 0
                ? backendsYaml(saved)
                : 'Pick the new backend to see the Endpoint it saves.'}
            </pre>
            <Typography variant="caption" color="textSecondary">
              {editing
                ? 'A new header, cookie, path or copy share cuts a new release, deployed to the first environment. New steps alone cut none.'
                : `One update to the Endpoint, so one new release, deployed to ${
                    firstEnvironment?.label ?? 'the first environment'
                  } with the new backend at 0%.`}
            </Typography>
          </Box>
        </Box>
      )}
    </DetailPageLayout>
  );
};

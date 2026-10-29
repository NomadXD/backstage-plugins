import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  TextField,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { useApi } from '@backstage/core-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import { CHOREO_ANNOTATIONS } from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { useProjectWorkloadEndpoints } from '../../scaffolder/EndpointBackendsField/useProjectWorkloadEndpoints';
import { getErrorMessage } from '../../utils/errorUtils';
import type { EndpointBackend } from './EndpointRoutingCard';

const optionKey = (component: string, endpoint: string) =>
  `${component}/${endpoint}`;

interface AddEndpointBackendDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called once the backend is saved. */
  onAdded: () => void;
  entity: Entity;
  backends: EndpointBackend[];
  /** The component managing the Endpoint, if it is component-managed. */
  managedByComponent?: string;
}

/**
 * Adds a backend to an Endpoint. A component-managed Endpoint first asks to
 * move to its project, since routing to anything but its component makes
 * it a project Endpoint: listed in the project's contents, no longer
 * managed from the component's configure page or deployed with it.
 */
export const AddEndpointBackendDialog = ({
  open,
  onClose,
  onAdded,
  entity,
  backends,
  managedByComponent,
}: AddEndpointBackendDialogProps) => {
  const client = useApi(openChoreoClientApiRef);
  const project = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.PROJECT];
  const endpointName = entity.metadata.title ?? entity.metadata.name;
  const [confirmed, setConfirmed] = useState(false);
  const [selected, setSelected] = useState('');
  const [weight, setWeight] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setConfirmed(!managedByComponent);
      setSelected('');
      setWeight(1);
      setError(null);
    }
  }, [open, managedByComponent]);

  const {
    options,
    loading,
    error: loadError,
  } = useProjectWorkloadEndpoints(
    confirmed ? entity.metadata.namespace : undefined,
    project,
  );
  // Any workload endpoint can be a backend: the Endpoint carries the
  // visibility, so the workload endpoint needs none of its own.
  const available = useMemo(() => {
    const taken = new Set(
      backends.map(b => optionKey(b.component ?? '', b.endpoint ?? '')),
    );
    return options.filter(o => !taken.has(optionKey(o.component, o.endpoint)));
  }, [options, backends]);

  const handleAdd = async () => {
    const option = available.find(
      o => optionKey(o.component, o.endpoint) === selected,
    );
    if (!option) return;
    setSaving(true);
    setError(null);
    try {
      await client.addEndpointBackend(entity, {
        component: option.component,
        workloadEndpoint: option.endpoint,
        weight,
      });
      onAdded();
      onClose();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!confirmed) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        aria-labelledby="move-endpoint-dialog-title"
      >
        <DialogTitle id="move-endpoint-dialog-title">
          Move Endpoint to the project?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {endpointName} is managed by component {managedByComponent}. Adding
            a backend moves it to project {project}: it is listed in the
            project's contents, is no longer managed from {managedByComponent}'s
            configure page, and is deployed on its own rather than with{' '}
            {managedByComponent}.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            color="primary"
            variant="contained"
            onClick={() => setConfirmed(true)}
          >
            Move to project
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  let picker = (
    <TextField
      id="endpoint-backend-workload-endpoint"
      select
      fullWidth
      variant="outlined"
      size="small"
      label="Workload endpoint"
      value={selected}
      onChange={e => setSelected(e.target.value as string)}
      disabled={saving}
      helperText={
        available.length === 0
          ? `No other workload endpoint in project ${project} to route to.`
          : undefined
      }
    >
      {available.map(o => (
        <MenuItem
          key={optionKey(o.component, o.endpoint)}
          value={optionKey(o.component, o.endpoint)}
        >
          {o.component} / {o.endpoint}
        </MenuItem>
      ))}
    </TextField>
  );
  if (loading) {
    picker = <CircularProgress size={24} />;
  } else if (loadError) {
    picker = (
      <Alert severity="error">
        Could not load the project's workload endpoints:{' '}
        {getErrorMessage(loadError)}
      </Alert>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="add-endpoint-backend-dialog-title"
    >
      <DialogTitle id="add-endpoint-backend-dialog-title">
        Add backend
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          Route part of {endpointName}'s traffic to another workload endpoint of
          project {project}.
        </DialogContentText>
        <Box mb={2}>{picker}</Box>
        <TextField
          type="number"
          variant="outlined"
          size="small"
          label="Weight"
          value={weight}
          onChange={e =>
            setWeight(Math.max(0, parseInt(e.target.value, 10) || 0))
          }
          inputProps={{ min: 0, step: 1 }}
          helperText="Relative to the other backends; a backend without a weight counts as 1."
          disabled={saving}
        />
        {error && (
          <Box mt={2}>
            <Alert severity="error">{error}</Alert>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          color="primary"
          variant="contained"
          onClick={handleAdd}
          disabled={saving || !selected}
        >
          {saving ? 'Adding...' : 'Add backend'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

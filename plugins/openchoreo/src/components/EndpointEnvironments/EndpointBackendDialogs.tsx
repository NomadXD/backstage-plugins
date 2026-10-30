import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { useApi } from '@backstage/core-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { getErrorMessage } from '../../utils/errorUtils';
import type { EndpointBackend } from '../EndpointOverview/EndpointBackendList';

/** Backend weights the Endpoint CRD accepts. */
export const MAX_BACKEND_WEIGHT = 1_000_000;

const backendLabel = (backend: EndpointBackend) =>
  backend.component
    ? `${backend.component}${backend.endpoint ? ` / ${backend.endpoint}` : ''}`
    : backend.name;

/** Runs a save, keeping the dialog open with the error when it fails. */
function useSave(onDone: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (save: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await save();
      onDone();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, setError, run };
}

interface BackendDialogProps {
  /** The backend acted on; the dialog is open while it is set. */
  backend: EndpointBackend | null;
  entity: Entity;
  onClose: () => void;
  /** Called once the change is saved, with what to tell the user. */
  onSaved: (message: string) => void;
}

/** Sets the relative weight of one of an Endpoint's backends. */
export const EditBackendWeightDialog = ({
  backend,
  entity,
  onClose,
  onSaved,
}: BackendDialogProps) => {
  const client = useApi(openChoreoClientApiRef);
  const [weight, setWeight] = useState(1);
  const { saving, error, setError, run } = useSave(onClose);

  useEffect(() => {
    if (backend) {
      setWeight(backend.weight ?? 1);
      setError(null);
    }
  }, [backend, setError]);

  const valid =
    Number.isInteger(weight) && weight >= 0 && weight <= MAX_BACKEND_WEIGHT;

  return (
    <Dialog
      open={!!backend}
      onClose={saving ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="edit-backend-weight-dialog-title"
    >
      <DialogTitle id="edit-backend-weight-dialog-title">
        Edit weight
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          Traffic share of {backend && backendLabel(backend)}, relative to the
          other backends. 0 sends it no traffic.
        </DialogContentText>
        <TextField
          id="endpoint-backend-weight"
          type="number"
          variant="outlined"
          size="small"
          label="Weight"
          value={weight}
          onChange={e => setWeight(parseInt(e.target.value, 10))}
          inputProps={{ min: 0, max: MAX_BACKEND_WEIGHT, step: 1 }}
          error={!valid}
          helperText={
            valid ? undefined : `A whole number from 0 to ${MAX_BACKEND_WEIGHT}`
          }
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
          disabled={saving || !valid || weight === (backend?.weight ?? 1)}
          onClick={() =>
            backend &&
            run(async () => {
              await client.updateEndpointBackendWeight(
                entity,
                backend.name,
                weight,
              );
              onSaved(`Weight of ${backendLabel(backend)} set to ${weight}.`);
            })
          }
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/** Removes one of an Endpoint's backends, after confirming. */
export const RemoveBackendDialog = ({
  backend,
  entity,
  onClose,
  onSaved,
}: BackendDialogProps) => {
  const client = useApi(openChoreoClientApiRef);
  const { saving, error, setError, run } = useSave(onClose);

  useEffect(() => {
    if (backend) setError(null);
  }, [backend, setError]);

  return (
    <Dialog
      open={!!backend}
      onClose={saving ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="remove-backend-dialog-title"
    >
      <DialogTitle id="remove-backend-dialog-title">
        Remove backend?
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          {entity.metadata.title ?? entity.metadata.name} stops routing traffic
          to {backend && backendLabel(backend)}; the other backends share it.
        </DialogContentText>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          color="secondary"
          variant="contained"
          disabled={saving}
          onClick={() =>
            backend &&
            run(async () => {
              await client.removeEndpointBackend(entity, backend.name);
              onSaved(`Backend ${backendLabel(backend)} removed.`);
            })
          }
        >
          {saving ? 'Removing...' : 'Remove'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

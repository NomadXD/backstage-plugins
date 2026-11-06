import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { getErrorMessage } from '../../../utils/errorUtils';

type Header = { name: string; value: string };

/** A pending traffic change that needs a confirmation first. */
export interface TrafficConfirmation {
  title: string;
  body: string;
  confirmLabel: string;
  /** When set, asks for a header, prefilled with this one, and passes it to run. */
  header?: Header;
  run: (header?: Header) => Promise<void>;
}

/** Confirms a rollout change, saying exactly what moves. */
export const ConfirmTrafficDialog = ({
  confirmation,
  onClose,
}: {
  confirmation: TrafficConfirmation | null;
  onClose: () => void;
}) => {
  const [header, setHeader] = useState<Header>({ name: '', value: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHeader(confirmation?.header ?? { name: '', value: '' });
    setError(null);
  }, [confirmation]);

  const confirm = async () => {
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    try {
      await confirmation.run(confirmation.header ? header : undefined);
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const asksHeader = Boolean(confirmation?.header);
  return (
    <Dialog
      open={confirmation !== null}
      onClose={() => !busy && onClose()}
      maxWidth="sm"
      fullWidth
      aria-labelledby="confirm-traffic-title"
    >
      <DialogTitle id="confirm-traffic-title">
        {confirmation?.title}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" paragraph>
          {confirmation?.body}
        </Typography>
        {asksHeader && (
          <Box display="flex" gridGap={8}>
            <TextField
              id="confirm-traffic-header-name"
              size="small"
              variant="outlined"
              label="Header testers send"
              value={header.name}
              onChange={e => setHeader(h => ({ ...h, name: e.target.value }))}
            />
            <TextField
              id="confirm-traffic-header-value"
              size="small"
              variant="outlined"
              label="Value"
              value={header.value}
              onChange={e => setHeader(h => ({ ...h, value: e.target.value }))}
            />
          </Box>
        )}
        {error && (
          <Alert severity="error" style={{ marginTop: 16 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={busy || (asksHeader && (!header.name || !header.value))}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          onClick={() => void confirm()}
        >
          {confirmation?.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
